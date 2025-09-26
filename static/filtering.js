// static/filtering.js
const searchInput = document.getElementById('search-input');
const hideOfftopicCheckbox = document.getElementById('hide-offtopic-checkbox');
const hideXrayCheckbox = document.getElementById('hide-xray-checkbox');
const hideApprovedCheckbox = document.getElementById('hide-approved-checkbox');
const onlySurveyCheckbox = document.getElementById('only-survey-checkbox');

const showPCBcheckbox = document.getElementById('show-pcb-checkbox');
const showSolderCheckbox = document.getElementById('show-solder-checkbox');
const showPCBAcheckbox = document.getElementById('show-pcba-checkbox');

const minPageCountInput = document.getElementById('min-page-count');
const yearFromInput = document.getElementById('year-from');
const yearToInput = document.getElementById('year-to');
const visiblePapersCountCell = document.getElementById('visible-papers-count');
const loadedPapersCountCell = document.getElementById('loaded-papers-count');
const applyButton = document.getElementById('apply-serverside-filters');
// const totalPapersCountCell = document.getElementById('total-papers-count');

const headers = document.querySelectorAll('th[data-sort]');
let currentClientSort = { column: null, direction: 'ASC' };

let filterTimeoutId = null;
const FILTER_DEBOUNCE_DELAY = 200;

// Pre-calculate symbol weights OUTSIDE the sort loop for efficiency
const SYMBOL_SORT_WEIGHTS = {
    '✔️': 2, // Yes
    '❌': 1, // No
    '❔': 0  // Unknown
};

const SYMBOL_PDF_WEIGHTS = {
    '📗': 2, // Annotated
    '📕': 1, // PDF
    '❔': 0  // None
};

function updateCounts() {   //used by stats, comms and filtering
    const counts = {};
    const yearlySurveyImpl = {}; // { year: { surveys: count, impl: count } }
    const yearlyTechniques = {}; // { year: { technique_field: count, ... } }
    const yearlyFeatures =   {}; // { year: { feature_field: count, ... } }
    const yearlyPubTypes = {}; // { year: { pubtype1: count, pubtype2: count, ... } }

    // Initialize counts for all defined fields
    COUNT_FIELDS.forEach(field => counts[field] = 0);

    // Select only VISIBLE main rows for counting '✔️' and calculating visible count
    const visibleRows = document.querySelectorAll('#papersTable tbody tr[data-paper-id]:not(.filter-hidden)');
    const visiblePaperCount = visibleRows.length;

    //count on each update since server-side async can change this:
    const allRows = document.querySelectorAll('#papersTable tbody tr[data-paper-id]');
    const loadedPaperCount = allRows.length;

    // Count symbols in visible rows and collect yearly data
    visibleRows.forEach(row => {
        // --- NEW: Count PDF status ---
        const pdfCell = row.cells[pdfCellIndex];
        if (pdfCell) {
            const pdfContent = pdfCell.textContent.trim();
            // Increment counts based on the emoji in the PDF cell
            if (pdfContent === '📕') { // PDF present
                counts['pdf_present'] = (counts['pdf_present'] || 0) + 1;
            } else if (pdfContent === '📗') { // Annotated PDF present
                counts['pdf_annotated'] = (counts['pdf_annotated'] || 0) + 1;
                // Also count annotated as a PDF present
                counts['pdf_present'] = (counts['pdf_present'] || 0) + 1;
            }
            // '❔' means no PDF, so no increment needed for this state
        }

        // --- Existing Count Logic for other fields ---
        COUNT_FIELDS.forEach(field => {
            // Skip the newly added PDF fields as they are handled separately above
            if (field === 'pdf_present' || field === 'pdf_annotated') {
                 return; // Skip to the next field
            }
            const cell = row.querySelector(`[data-field="${field}"]`);
            const cellText = cell ? cell.textContent.trim() : '';
            if (field === 'changed_by' || field === 'verified_by') {
                if (cellText === '👤') {
                    counts[field]++;
                }
            } else {
                if (cellText === '✔️') {
                    counts[field]++;
                }
            }
        });

        // ... (rest of the yearly data collection logic remains the same) ...
        const yearCell = row.cells[yearCellIndex]; // Assuming Year is the 3rd column (index 2)
        const yearText = yearCell ? yearCell.textContent.trim() : '';
        const year = yearText ? parseInt(yearText, 10) : null;

        if (year && !isNaN(year)) {
            // Initialize yearly data objects for the year if they don't exist
            if (!yearlySurveyImpl[year]) {
                yearlySurveyImpl[year] = { surveys: 0, impl: 0 };
            }
            if (!yearlyTechniques[year]) {
                yearlyTechniques[year] = {};
                TECHNIQUE_FIELDS_FOR_YEARLY.forEach(f => yearlyTechniques[year][f] = 0);
            }
            if (!yearlyFeatures[year]) {
                yearlyFeatures[year] = {};
                FEATURE_FIELDS_FOR_YEARLY.forEach(f => yearlyFeatures[year][f] = 0);
            }


            // --- NEW: Update Publication Type counts ---
            const typeCell = row.cells[typeCellIndex]; // Assuming Type is the 1st column (index 0)
            const pubTypeText = typeCell ? typeCell.getAttribute('title') || typeCell.textContent.trim() : ''; // Use title for full type if available
            if (pubTypeText) {
                if (!yearlyPubTypes[year]) {
                    yearlyPubTypes[year] = {}; // Initialize object for this year's types
                }
                // Increment count for this type in this year
                yearlyPubTypes[year][pubTypeText] = (yearlyPubTypes[year][pubTypeText] || 0) + 1;
            }

            // Update Survey/Impl counts
            const isSurveyCell = row.querySelector('.editable-status[data-field="is_survey"]');
            const isSurvey = isSurveyCell && isSurveyCell.textContent.trim() === '✔️';
            if (isSurvey) {
                yearlySurveyImpl[year].surveys++;
            } else {
                yearlySurveyImpl[year].impl++;
            }

            // Update Technique counts
            TECHNIQUE_FIELDS_FOR_YEARLY.forEach(field => {
                const techCell = row.querySelector(`.editable-status[data-field="${field}"]`);
                if (techCell && techCell.textContent.trim() === '✔️') {
                    yearlyTechniques[year][field]++;
                }
            });

            // Update Feature counts
            FEATURE_FIELDS_FOR_YEARLY.forEach(field => {
                // const featCell = row.querySelector(`.editable-status[data-field="${field}"]`); //breaks "other" counts in chart, as it's a calculated, non-editable cell!
                const featCell = row.querySelector(`[data-field="${field}"]`);
                if (featCell && featCell.textContent.trim() === '✔️') {
                    yearlyFeatures[year][field]++;
                }
            });
        }
    });
    // Make counts available outside this function
    latestCounts = counts;
    latestYearlyData = {
        surveyImpl: yearlySurveyImpl,
        techniques: yearlyTechniques,
        features: yearlyFeatures,
        pubTypes: yearlyPubTypes // <-- Add this line
    };

    loadedPapersCountCell.textContent = loadedPaperCount;
    visiblePapersCountCell.textContent = visiblePaperCount;

    // --- Update Footer Counts ---
    COUNT_FIELDS.forEach(field => {
        // Skip the 'pdf_annotated' field for direct footer update, as it's part of the combined PDF cell
        if (field === 'pdf_annotated') {
             return; // Skip updating the individual annotated count cell directly
        }

        const countCell = document.getElementById(`count-${field}`);
        if (countCell) {
            // For 'pdf_present', set the text content to the total count
            // and add a tooltip showing both counts
            if (field === 'pdf_present') {
                countCell.textContent = counts['pdf_present'];
                countCell.title = `Stored PDFs: ${counts['pdf_present']}, Annotated PDFs: ${counts['pdf_annotated']}`; // Set tooltip
            } else {
                // For all other fields, set the text content normally
                countCell.textContent = counts[field];
            }
        }
    });

    // Ensure the 'pdf_annotated' count cell is cleared or hidden if it exists,
    // as its value is now part of the 'pdf_present' cell's tooltip.
    // This is just for cleanliness if the HTML still references it.
    const annotatedCountCell = document.getElementById('count-pdf_annotated');
    if (annotatedCountCell) {
        // Option 1: Hide it if it exists
        // annotatedCountCell.style.display = 'none';
        // Option 2: Clear its content (more common if layout is fixed)
        annotatedCountCell.textContent = '';
        annotatedCountCell.title = ''; // Clear any existing title
    }
}


function toggleDetails(element) {
    const row = element.closest('tr');
    const detailRow = row.nextElementSibling;
    const isExpanded = detailRow && detailRow.classList.contains('expanded');
    const paperId = row.getAttribute('data-paper-id');

    if (isExpanded) {
        detailRow.classList.remove('expanded');
        element.innerHTML = '<span>Show</span>';
    } else {
        detailRow.classList.add('expanded');
        element.innerHTML = '<span>Hide</span>';
        const contentPlaceholder = detailRow.querySelector('.detail-content-placeholder');
        fetch(`/get_detail_row?paper_id=${encodeURIComponent(paperId)}`)
            .then(response => {
                return response.json();
            })
            .then(data => {
                if (data.status === 'success' && data.html) {
                    contentPlaceholder.innerHTML = data.html;
                } else {  // Handle error from server
                    console.error(`Error loading detail row for paper ${paperId}:`, data.message);
                    if (contentPlaceholder) {
                        contentPlaceholder.innerHTML = `<p>Error loading details: ${data.message || 'Unknown error'}</p>`;
                    }
                }
            })
            .catch(error => {  // Handle network or other errors
                console.error(`Error fetching detail row for paper ${paperId}:`, error);
                if (contentPlaceholder) {
                    contentPlaceholder.innerHTML = `<p>Error loading details: ${error.message}</p>`;
                }
            });
    }
}
/**
 * Applies alternating row shading to visible main rows.
 * Ensures detail rows follow their main row's shading.
 * Each "paper group" (main row + detail row) gets a single alternating color.
 */
function applyAlternatingShading() {
    // Select only visible main rows
    const visibleMainRows = document.querySelectorAll('#papersTable tbody tr[data-paper-id]:not(.filter-hidden)');

    // Iterate through the visible main rows. The index 'index' now represents the paper group index.
    visibleMainRows.forEach((mainRow, groupIndex) => {
        // Determine the shade class based on the paper group index (groupIndex)
        // This ensures each paper group (main + detail) gets one color, alternating per group.
        const shadeClass = (groupIndex % 2 === 0) ? 'alt-shade-1' : 'alt-shade-2';

        // Remove any existing alternating shade classes from the main row
        mainRow.classList.remove('alt-shade-1', 'alt-shade-2');
        mainRow.classList.add(shadeClass);

        // --- Handle Detail Row Shading ---
        mainRow.nextElementSibling.classList.remove('alt-shade-1', 'alt-shade-2');
        mainRow.nextElementSibling.classList.add(shadeClass);
        // Note: Ensure CSS .detail-row has background-color: inherit; or no background-color set
        // so it uses the one from the .alt-shade-* class.
    });
}

function applyDuplicateShading(rows) {
    const journalCounts = new Map();
    const titleCounts = new Map();

    // Count occurrences for both journal names and titles
    rows.forEach(row => {
        if (!row.classList.contains('filter-hidden')) {
            const journalCell = row.cells[journalCellIndex];
            const titleCell = row.cells[titleCellIndex];
            
            const journalName = journalCell.textContent.trim();
            const title = titleCell.textContent.trim();
            
            journalCounts.set(journalName, (journalCounts.get(journalName) || 0) + 1);
            titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
        }
    });

    // Count duplicate titles (only titles with 2 or more occurrences)
    let duplicateTitleCount = 0;
    for (const [title, count] of titleCounts) {
        if (title && count >= 2) {
            duplicateTitleCount++;
        }
    }
    
    // Update the duplicate papers count in HTML
    const duplicateCountElement = document.getElementById('duplicate-papers-count');
    if (duplicateCountElement) {
        duplicateCountElement.textContent = duplicateTitleCount;
    }

    // Determine the maximum count for scaling (for journals only)
    let maxCount = 0;
    for (const count of journalCounts.values()) {
        if (count > maxCount) maxCount = count;
    }

    // Define base shade colors
    const baseJournalHue = 210; // Blueish
    const baseSaturation = 66;
    const minLightness = 96; // Lightest shade (almost white)
    const maxLightness = 84; // Darkest shade when maxCount is high
    
    const baseTitleHue = 0; // Reddish
    const titleSaturation = 66;
    const titleLightness = 94; // Consistent light red

    rows.forEach(row => {
        const journalCell = row.cells[journalCellIndex];
        const titleCell = row.cells[titleCellIndex];
        
        // Reset background colors
        journalCell.style.backgroundColor = '';
        titleCell.style.backgroundColor = '';

        // Only apply shading if the row is visible
        if (!row.classList.contains('filter-hidden')) {
            const journalName = journalCell.textContent.trim();
            const title = titleCell.textContent.trim();
            
            // Apply journal shading (progressive)
            if (journalName && journalName) {
                const journalCount = journalCounts.get(journalName) || 0;
                if (journalCount >= 2) { 
                    let lightness;
                    if (maxCount <= 1) {
                        lightness = minLightness;
                    } else {
                        lightness = maxLightness + (minLightness - maxLightness) * (1 - (journalCount - 1) / (maxCount - 1));
                        lightness = Math.max(maxLightness, Math.min(minLightness, lightness));
                    }
                    journalCell.style.backgroundColor = `hsl(${baseJournalHue}, ${baseSaturation}%, ${lightness}%)`;
                }
            }
            
            // Apply title shading (consistent red for duplicates)
            if (title && title) {
                const titleCount = titleCounts.get(title) || 0;
                if (titleCount >= 2) {
                    titleCell.style.backgroundColor = `hsl(${baseTitleHue}, ${titleSaturation}%, ${titleLightness}%)`;
                }
            }
        }
    });
}
function applyServerSideFilters() {
    document.documentElement.classList.add('busyCursor');
    const urlParams = new URLSearchParams(window.location.search);

    const isOfftopicChecked = hideOfftopicCheckbox.checked;
    urlParams.set('hide_offtopic', isOfftopicChecked ? '1' : '0');

    const yearFromValue = document.getElementById('year-from').value.trim();
    if (yearFromValue !== '' && !isNaN(parseInt(yearFromValue))) {
        urlParams.set('year_from', yearFromValue);
    } else {
        urlParams.delete('year_from');
    }
    const yearToValue = document.getElementById('year-to').value.trim();
    if (yearToValue !== '' && !isNaN(parseInt(yearToValue))) {
        urlParams.set('year_to', yearToValue);
    } else {
        urlParams.delete('year_to');
    }

    const minPageCountValue = document.getElementById('min-page-count').value.trim();
    if (minPageCountValue !== '' && !isNaN(parseInt(minPageCountValue))) {
        urlParams.set('min_page_count', minPageCountValue);
    } else {
        urlParams.delete('min_page_count');
    }

    const searchValue = document.getElementById('search-input').value.trim();
    if (searchValue !== '') {
        urlParams.set('search_query', searchValue);
    } else {
        urlParams.delete('search_query');
    }
    // Construct the URL for the /load_table endpoint with current parameters
    const loadTableUrl = `/load_table?${urlParams.toString()}`;
    fetch(loadTableUrl)
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.text();
        })
        .then(html => {
            const tbody = document.querySelector('#papersTable tbody');
            if (tbody) {
                tbody.innerHTML = html;
                const newUrl = `${window.location.pathname}?${urlParams.toString()}`;
                window.history.replaceState({ path: newUrl }, '', newUrl);
                applyLocalFilters(); //update local filters and let it remove busy state
            }
        })
        .catch(error => {
            console.error('Error fetching updated table:', error);
            document.documentElement.classList.remove('busyCursor');
        });
}

function applyLocalFilters() {
    clearTimeout(filterTimeoutId);
    document.documentElement.classList.add('busyCursor');    // Set the cursor immediately on user interaction
    filterTimeoutId = setTimeout(() => {// Debounce the actual filtering
        const tbody = document.querySelector('#papersTable tbody');
        if (!tbody) return;
        const hideXrayChecked = hideXrayCheckbox.checked;
        const onlySurveyChecked = onlySurveyCheckbox.checked;
        const hideApprovedChecked = hideApprovedCheckbox.checked;

        // --- NEW: Get the state of PCB/Solder/PCBA checkboxes ---
        const showPCBChecked = showPCBcheckbox.checked;
        const showSolderChecked = showSolderCheckbox.checked;
        const showPCBAChecked = showPCBAcheckbox.checked;

        const rows = tbody.querySelectorAll('tr[data-paper-id]');
        rows.forEach(row => {
            let showRow = true;
            let detailRow = row.nextElementSibling; // Get the associated detail row

            // Existing filters (X-Ray, Survey, Approved)
            if (showRow && hideXrayChecked) {
                const xrayCell = row.querySelector('.editable-status[data-field="is_x_ray"]');
                if (xrayCell && xrayCell.textContent.trim() === '✔️') {
                    showRow = false;
                }
            }
            if (showRow && onlySurveyChecked) {
                const surveyCell = row.querySelector('.editable-status[data-field="is_survey"]');
                if (surveyCell && surveyCell.textContent.trim() === '❌') {
                    showRow = false;
                }
            }
            if (showRow && hideApprovedChecked) {
                const verifiedCell = row.querySelector('.editable-status[data-field="verified"]');
                if (verifiedCell && verifiedCell.textContent.trim() === '✔️') {
                    showRow = false;
                }
            }

            // --- Apply NEW PCB/Solder/PCBA Group Filters (Inclusion via OR Logic) ---
            // Only apply this filter if at least one group is enabled (checked)
            if (showRow && (showPCBChecked || showSolderChecked || showPCBAChecked)) {
                let hasPCBFeature = false;
                let hasSolderFeature = false;
                let hasPCBAFeature = false;

                // Helper function to check if a paper has ANY '✔️' in a given list of feature fields
                const hasAnyFeature = (featureFields) => {
                    return featureFields.some(fieldName => {
                        const cell = row.querySelector(`[data-field="${fieldName}"]`);
                        return cell && cell.textContent.trim() === '✔️';
                    });
                };

                // Define feature fields for each group
                const pcbFeatures = ['features_tracks', 'features_holes'];
                const solderFeatures = [
                    'features_solder_insufficient',
                    'features_solder_excess',
                    'features_solder_void',
                    'features_solder_crack'
                ];
                const pcbaFeatures = [
                    'features_orientation',
                    'features_missing_component',
                    'features_wrong_component',
                    'features_cosmetic',
                    'features_other_state'
                ];

                // Check which groups the paper belongs to (has at least one ✔️)
                if (showPCBChecked) {
                    hasPCBFeature = hasAnyFeature(pcbFeatures);
                }
                if (showSolderChecked) {
                    hasSolderFeature = hasAnyFeature(solderFeatures);
                }
                if (showPCBAChecked) {
                    hasPCBAFeature = hasAnyFeature(pcbaFeatures);
                }

                // The core OR logic:
                // Hide the row ONLY if it does NOT belong to ANY of the enabled groups.
                // In other words, show the row if it belongs to at least one enabled group.
                if (!(hasPCBFeature || hasSolderFeature || hasPCBAFeature)) {
                    showRow = false;
                }
            }
            // Apply the visibility state
            row.classList.toggle('filter-hidden', !showRow);
            if (detailRow) { // Ensure detailRow exists before toggling
                detailRow.classList.toggle('filter-hidden', !showRow);
            }
        });

        applyAlternatingShading();
        applyDuplicateShading(document.querySelectorAll('#papersTable tbody tr[data-paper-id]:not(.filter-hidden)'));
        updateCounts();
        applyButton.style.opacity = '0';
        applyButton.style.pointerEvents = 'none';
        setTimeout(() => {
            document.documentElement.classList.remove('busyCursor');
        }, 150); // doesn't really work since the contents are completely replaced eliminating the animation. Not worth fixing.
    }, FILTER_DEBOUNCE_DELAY);
}

function sortTable(){
    document.documentElement.classList.add('busyCursor');

    setTimeout(() => {
        const sortBy = this.getAttribute('data-sort');
        if (!sortBy) return;

        let newDirection = 'DESC';
        if (currentClientSort.column === sortBy) {
            newDirection = currentClientSort.direction === 'DESC' ? 'ASC' : 'DESC';
        }
        const tbody = document.querySelector('#papersTable tbody');

        // --- PRE-PROCESS: Extract Sort Values and Row References ---
        const visibleMainRows = tbody.querySelectorAll('tr[data-paper-id]:not(.filter-hidden)');
        const headerIndex = Array.prototype.indexOf.call(this.parentNode.children, this);
        const sortData = [];
        let mainRow, paperId, cellValue, detailRow, cell;

        for (let i = 0; i < visibleMainRows.length; i++) {
            mainRow = visibleMainRows[i];
            paperId = mainRow.getAttribute('data-paper-id');

            // --- Extract cell value based on column type ---
            if (['title', 'year', 'journal', /*'authors',*/ 'page_count', 'estimated_score', 'relevance'].includes(sortBy)) {
                cell = mainRow.cells[headerIndex];
                cellValue = cell ? cell.textContent.trim() : '';
                if (sortBy === 'year' || sortBy === 'estimated_score' || sortBy === 'page_count' || sortBy === 'relevance') {
                    cellValue = parseFloat(cellValue) || 0;
                }
            } else if (['type', 'changed', 'changed_by', 'verified', 'verified_by', 'research_area', 'user_comment_state', 'features_other_state'].includes(sortBy)) {
                cell = mainRow.cells[headerIndex];
                cellValue = cell ? cell.textContent.trim() : '';
            } else if (sortBy === 'pdf-link') { // NEW: Handle PDF link column sorting
                cell = mainRow.cells[headerIndex]; // PDF cell is the second cell (index 1)
                cellValue = cell ? cell.textContent.trim() : '';

                // Use the weight, defaulting to 0 if symbol not found
                cellValue = SYMBOL_PDF_WEIGHTS[cellValue] ?? 0;
            } else { // Status/Feature/Technique columns
                cell = mainRow.querySelector(`.editable-status[data-field="${sortBy}"]`);
                // Use SYMBOL_SORT_WEIGHTS for sorting, defaulting to 0 if symbol not found
                cellValue = SYMBOL_SORT_WEIGHTS[cell?.textContent.trim()] ?? 0;
            }

            detailRow = mainRow.nextElementSibling; // Get the associated detail row
            sortData.push({ value: cellValue, mainRow, detailRow, paperId });
        }

        sortData.sort((a, b) => {
            let comparison = 0;
            if (a.value > b.value) comparison = 1;
            else if (a.value < b.value) comparison = -1;
            else {  // Secondary sort by paperId to ensure stable sort
                if (a.paperId > b.paperId) comparison = 1;
                else if (a.paperId < b.paperId) comparison = -1;
            }
            return newDirection === 'DESC' ? -comparison : comparison;
        });

        // --- BATCH UPDATE the DOM ---
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < sortData.length; i++) {
            fragment.appendChild(sortData[i].mainRow);
            fragment.appendChild(sortData[i].detailRow);
        }
        tbody.appendChild(fragment); // Single DOM append operation

        // --- Schedule UI Updates after DOM change ---
        // Use requestAnimationFrame to align with browser repaint
        requestAnimationFrame(() => {
            applyAlternatingShading();
            const currentVisibleRowsForJournal = document.querySelectorAll('#papersTable tbody tr[data-paper-id]:not(.filter-hidden)');
            applyDuplicateShading(currentVisibleRowsForJournal);
            updateCounts();
        });
        currentClientSort = { column: sortBy, direction: newDirection };
        document.querySelectorAll('th .sort-indicator').forEach(ind => ind.textContent = '');
        const indicator = this.querySelector('.sort-indicator');
        if (indicator) {
            indicator.textContent = newDirection === 'ASC' ? '▲' : '▼';
        }
        // 3. Schedule removal of the busy cursor class AFTER a guaranteed delay
        // This ensures the CSS transition has time to play.
        // The delay (150ms) should be >= CSS transition duration (0.3s) + delay (0.1s) if you want full transition,
        // but even a shorter delay (longer than CSS delay) often works to trigger it.
        setTimeout(() => {
            document.documentElement.classList.remove('busyCursor');
        }, 150); // Delay slightly longer than CSS transition delay
    }, 20); // Initial defer for adding busy cursor (can keep this small or match rAF timing ~16ms)
}

function showApplyButton(){  applyButton.style.opacity = '1'; applyButton.style.pointerEvents = 'visible'; }

document.addEventListener('DOMContentLoaded', function () {
    hideOfftopicCheckbox.addEventListener('change', applyServerSideFilters);
    hideXrayCheckbox.addEventListener('change', applyLocalFilters);
    hideApprovedCheckbox.addEventListener('change', applyLocalFilters);
    onlySurveyCheckbox.addEventListener('change', applyLocalFilters);
    showPCBcheckbox.addEventListener('change', applyLocalFilters);
    showSolderCheckbox.addEventListener('change', applyLocalFilters);
    showPCBAcheckbox.addEventListener('change', applyLocalFilters);

    yearFromInput.addEventListener('change', showApplyButton);
    yearToInput.addEventListener('change', showApplyButton);
    minPageCountInput.addEventListener('change', showApplyButton);

    applyButton.addEventListener('click', applyServerSideFilters);

    document.getElementById('search-input').addEventListener('input', function () {
        clearTimeout(filterTimeoutId);
        filterTimeoutId = setTimeout(() => {
            applyServerSideFilters();
        }, 300);  //additional debounce for typing
    });
    
    headers.forEach(header => { header.addEventListener('click', sortTable);   });
    applyLocalFilters(); //apply initial filtering    


    // 2. After initial filters are applied (which includes the initial sortTable call
    //    if triggered by applyLocalFilters, but we'll override it),
    //    find the 'user_comment_state' header and trigger the sort.
    //    Use setTimeout with 0 delay to ensure it runs after the current
    //    execution stack (including the applyLocalFilters timeout) is clear.
    setTimeout(() => {
        const commentedHeader = document.querySelector('th[data-sort="user_comment_state"]');
        if (commentedHeader) {
            // Set the initial sort state so the UI indicator is correct
            currentClientSort = { column: "user_comment_state", direction: 'DESC' }; // Or 'ASC' if preferred

            // Call sortTable with the correct 'this' context (the header element)
            // We need to bind 'this' or call it directly on the element
            sortTable.call(commentedHeader);

            // Update the sort indicator visually
            // Clear previous indicators
            document.querySelectorAll('th .sort-indicator').forEach(ind => ind.textContent = '');
            // Set the indicator on the target header
            const indicator = commentedHeader.querySelector('.sort-indicator');
            if (indicator) {
                 // Use '▼' for DESC, '▲' for ASC based on your sortTable logic
                indicator.textContent = currentClientSort.direction === 'ASC' ? '▲' : '▼';
            }
        }
    }, 0); // Ensures it runs after applyLocalFilters' timeout finishes
});