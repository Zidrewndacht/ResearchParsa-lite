// static/filtering.js

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
        const showNoFeaturesChecked = noFeaturesCheckbox.checked;

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
                const pcbFeatures = ['features_tracks', 'features_holes', 'features_bare_pcb_other'];
                const solderFeatures = [
                    'features_solder_insufficient',
                    'features_solder_excess',
                    'features_solder_void',
                    'features_solder_crack',
                    'features_solder_other'
                ];
                const pcbaFeatures = [
                    'features_orientation',
                    'features_missing_component',
                    'features_wrong_component',
                    'features_component_other',
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

            // Define feature fields that need to be checked for the "No Features" filter
            // These correspond to the data-field attributes in your table cells
            const featureFieldsToCheck = [
                'features_tracks', 'features_holes', 'features_bare_pcb_other',
                'features_solder_insufficient', 'features_solder_excess', 'features_solder_void', 'features_solder_crack', 'features_solder_other',
                'features_missing_component', 'features_wrong_component', 'features_component_other',
                'features_orientation', 'features_cosmetic',
                'features_other_state' // Note: 'features_other_state' is the editable cell. The actual 'other' text might be in the detail row, so filtering by its blank state might be the best we can do client-side.
            ];

            // --- Apply NEW "No Features" Filter ---
            // Only apply this filter if the checkbox is checked
            if (showRow && showNoFeaturesChecked) {
                // Check if ALL feature fields in the list are empty or contain only a space (' ')
                const hasAnyFeatureFilled = featureFieldsToCheck.some(fieldName => {
                    const cell = row.querySelector(`[data-field="${fieldName}"]`);
                    const cellText = cell ? cell.textContent.trim() : '';
                    // Consider '✔️', '❌', '👤', '🖥️' as filled. Blank (' ') or empty string means not filled.
                    // Also consider if the cell content is just the initial blank space.
                    return cellText !== '' && cellText !== '❌' && cellText !== '❔'; // Adjust if '❔' is the initial state instead of ' '
                });

                // Hide the row if ANY feature was found to be filled
                if (hasAnyFeatureFilled) {
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
    noFeaturesCheckbox.addEventListener('change', applyLocalFilters);

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