// static/ghpages.js
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

const allRows = document.querySelectorAll('#papersTable tbody tr[data-paper-id]');
const totalPaperCount = allRows.length;

let filterTimeoutId = null;
const FILTER_DEBOUNCE_DELAY = 200;
const headers = document.querySelectorAll('th[data-sort]');
let currentClientSort = { column: null, direction: 'ASC' };

//Hardocoded cells - to update in this script:
const pdfCellIndex = 0;
const titleCellIndex = 1;
const yearCellIndex = 2;
const pageCountCellIndex = 3;
const journalCellIndex = 4;
const typeCellIndex = 5;
const relevanceCellIndex = 7;
const estScoreCellIndex = 36;


const SYMBOL_SORT_WEIGHTS = {
    '✔️': 2,
    '❌': 1,
    '❔': 0
};

function scheduleFilterUpdate() {
    clearTimeout(filterTimeoutId);
    document.documentElement.classList.add('busyCursor');
    filterTimeoutId = setTimeout(() => {
        setTimeout(() => {
            const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
            const tbody = document.querySelector('#papersTable tbody');
            if (!tbody) return;

            // --- Get filter values ---
            const hideOfftopicChecked = hideOfftopicCheckbox.checked;
            const hideXrayChecked = hideXrayCheckbox.checked;
            const onlySurveyChecked = onlySurveyCheckbox.checked;
            const hideApprovedChecked = hideApprovedCheckbox.checked;
            const minPageCountValue = minPageCountInput ? parseInt(minPageCountInput.value, 10) || 0 : 0;
            // Get year range values
            const yearFromValue = yearFromInput ? parseInt(yearFromInput.value, 10) || 0 : 0;
            const yearToValue = yearToInput ? parseInt(yearToInput.value, 10) || Infinity : Infinity;
            // --- NEW: Get the state of PCB/Solder/PCBA checkboxes ---
            const showPCBChecked = showPCBcheckbox.checked;
            const showSolderChecked = showSolderCheckbox.checked;
            const showPCBAChecked = showPCBAcheckbox.checked;

            const rows = tbody.querySelectorAll('tr[data-paper-id]');
            rows.forEach(row => {
                let showRow = true;
                const paperId = row.getAttribute('data-paper-id');
                let detailRow = null;
                if (paperId) {
                    let nextSibling = row.nextElementSibling;
                    while (nextSibling && !nextSibling.classList.contains('detail-row')) {
                        if (nextSibling.hasAttribute('data-paper-id')) break;
                        nextSibling = nextSibling.nextElementSibling;
                    }
                    if (nextSibling && nextSibling.classList.contains('detail-row')) {
                        detailRow = nextSibling;
                    }
                }

                if (showRow && hideOfftopicChecked) {
                    const offtopicCell = row.querySelector('.editable-status[data-field="is_offtopic"]');
                    if (offtopicCell && offtopicCell.textContent.trim() === '✔️') {
                        showRow = false;
                    }
                }
                if (showRow && hideXrayChecked) {
                    const offtopicCell = row.querySelector('.editable-status[data-field="is_x_ray"]');
                    if (offtopicCell && offtopicCell.textContent.trim() === '✔️') {
                        showRow = false;
                    }
                }
                if (showRow && hideApprovedChecked) {
                    const offtopicCell = row.querySelector('.editable-status[data-field="verified"]');
                    if (offtopicCell && offtopicCell.textContent.trim() === '✔️') {
                        showRow = false;
                    }
                }
                if (showRow && onlySurveyChecked) {
                    const offtopicCell = row.querySelector('.editable-status[data-field="is_survey"]');
                    if (offtopicCell && offtopicCell.textContent.trim() === '❌') {
                        showRow = false;
                    }
                }

                // 2. Minimum Page Count
                // Only hide if page count is a known number and it's less than the minimum
                if (showRow && minPageCountValue > 0) { // Only check if min value is set
                    const pageCountCell = row.cells[4]; // Index 4 for 'Pages' column
                    if (pageCountCell) {
                        const pageCountText = pageCountCell.textContent.trim();
                        // Only filter if there's actual text to parse
                        if (pageCountText !== '') {
                            const pageCount = parseInt(pageCountText, 10);
                            // If parsing was successful and the number is less than the minimum, hide
                            if (!isNaN(pageCount) && pageCount < minPageCountValue) {
                                showRow = false;
                            }
                        }
                        // If pageCountText is '', pageCount is NaN, or pageCount >= min, row stays visible
                    }
                }

                // 3. Year Range
                if (showRow) {
                    const yearCell = row.cells[2]; // Index 2 for 'Year' column
                    if (yearCell) {
                        const yearText = yearCell.textContent.trim();
                        const year = yearText ? parseInt(yearText, 10) : NaN;
                        // If year is not a number or outside the range, hide the row
                        // Ensure year is valid before comparison
                        if (isNaN(year) || year < yearFromValue || year > yearToValue) {
                            showRow = false;
                        }
                    }
                }

                // 4. Search Term
                if (showRow && searchTerm) {
                    let rowText = (row.textContent || '').toLowerCase();
                    let detailText = '';
                    if (detailRow) {
                        const detailClone = detailRow.cloneNode(true);
                        // Exclude traces from search if desired (as in original)
                        detailClone.querySelector('.detail-evaluator-trace .trace-content')?.remove();
                        detailClone.querySelector('.detail-verifier-trace .trace-content')?.remove();
                        detailText = (detailClone.textContent || '').toLowerCase();
                    }
                    if (!rowText.includes(searchTerm) && !detailText.includes(searchTerm)) {
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
            updateCounts();
            applyAlternatingShading();
            document.documentElement.classList.remove('busyCursor');
        }, 0);
    }, FILTER_DEBOUNCE_DELAY);
}

function toggleDetails(element) {
    const row = element.closest('tr');
    const detailRow = row.nextElementSibling;
    const isExpanded = detailRow && detailRow.classList.contains('expanded');
    if (isExpanded) {
        if (detailRow) detailRow.classList.remove('expanded');
        element.innerHTML = '<span>Show</span>';
    } else {
        if (detailRow) detailRow.classList.add('expanded');
        element.innerHTML = '<span>Hide</span>';
    }
}

// --- Modified updateCounts Function ---
let latestCounts = {}; // This will store the counts calculated by updateCounts
let latestYearlyData = {}; // NEW: Store yearly data for charts

// Define the fields for which we want to count '✔️'
const COUNT_FIELDS = [
    'pdf_present', 
    'pdf_annotated',

    'is_offtopic', 'is_survey', 'is_through_hole', 'is_smt', 'is_x_ray', // Classification (Top-level)
    'features_tracks', 'features_holes', 'features_solder_insufficient', 'features_solder_excess',
    'features_solder_void', 'features_solder_crack', 'features_orientation', 'features_wrong_component',
    'features_missing_component', 'features_cosmetic', 'features_other_state', // Features (Nested under 'features')
    'technique_classic_cv_based', 'technique_ml_traditional',
    'technique_dl_cnn_classifier', 'technique_dl_cnn_detector', 'technique_dl_rcnn_detector',
    'technique_dl_transformer', 'technique_dl_other', 'technique_hybrid', 'technique_available_dataset', // Techniques (Nested under 'technique')
    'changed_by', 'verified', 'verified_by', 'user_comment_state' // Add these for user counting (Top-level)
];

// NEW: Define fields for techniques and features to track per year
const TECHNIQUE_FIELDS_FOR_YEARLY = [
    'technique_classic_cv_based', 'technique_ml_traditional',
    'technique_dl_cnn_classifier', 'technique_dl_cnn_detector', 'technique_dl_rcnn_detector',
    'technique_dl_transformer', 'technique_dl_other', 'technique_hybrid'
    // 'technique_available_dataset' is excluded from line chart per request
];
const FEATURE_FIELDS_FOR_YEARLY = [
    'features_tracks', 'features_holes', 'features_solder_insufficient', 'features_solder_excess',
    'features_solder_void', 'features_solder_crack', 'features_orientation', 'features_wrong_component',
    'features_missing_component', 'features_cosmetic', 'features_other_state'
];

function updateCounts() {
    const counts = {};
    const yearlySurveyImpl = {}; // { year: { surveys: count, impl: count } }
    const yearlyTechniques = {}; // { year: { technique_field: count, ... } }
    const yearlyFeatures = {};   // { year: { feature_field: count, ... } }
    const yearlyPubTypes = {}; // { year: { pubtype1: count, pubtype2: count, ... } }

    // Initialize counts for ALL status fields (including changed_by, verified_by)
    COUNT_FIELDS.forEach(field => counts[field] = 0);

    // Select only VISIBLE main rows for counting '✔️' and calculating visible count
    const visibleRows = document.querySelectorAll('#papersTable tbody tr[data-paper-id]:not(.filter-hidden)');
    const visiblePaperCount = visibleRows.length;

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

        const yearCell = row.cells[2]; // Assuming Year is the 3rd column (index 2)
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

    latestCounts = counts; // Make counts available outside this function
    // NEW: Make yearly data available
    latestYearlyData = {
        surveyImpl: yearlySurveyImpl,
        techniques: yearlyTechniques,
        features: yearlyFeatures,
        pubTypes: yearlyPubTypes // <-- Add this line
    };

    const allRows = document.querySelectorAll('#papersTable tbody tr[data-paper-id]');
    const totalPaperCount = allRows.length;
    latestCounts = counts; // Make counts available outside this function
    document.getElementById('visible-count-cell').innerHTML = `<strong>${visiblePaperCount}</strong> paper${visiblePaperCount !== 1 ? 's' : ''} of <strong>${totalPaperCount}</strong>`;

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
}

function applyAlternatingShading() {
    const visibleMainRows = document.querySelectorAll('#papersTable tbody tr[data-paper-id]:not(.filter-hidden)');
    visibleMainRows.forEach((mainRow, groupIndex) => {
        const shadeClass = (groupIndex % 2 === 0) ? 'alt-shade-1' : 'alt-shade-2';
        mainRow.classList.remove('alt-shade-1', 'alt-shade-2');
        mainRow.classList.add(shadeClass);
        mainRow.nextElementSibling.classList.remove('alt-shade-1', 'alt-shade-2');
        mainRow.nextElementSibling.classList.add(shadeClass);
    });
}

function sortTable() {
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


const statsBtn = document.getElementById('static-stats-btn');
const modal = document.getElementById('statsModal');
const spanClose = document.querySelector('#statsModal .close');
const aboutBtn = document.getElementById('static-about-btn');
const modalSmall = document.getElementById('aboutModal');
const smallClose = document.querySelector('#aboutModal .close');

function calculateStats() {
    const stats = {
        journals: {},
        keywords: {},
        authors: {},
        researchAreas: {},
        otherDetectedFeatures: {}, // This line is crucial
        modelNames: {}             // This line is crucial
    };

    const visibleRows = document.querySelectorAll('#papersTable tbody tr[data-paper-id]:not(.filter-hidden)');
    visibleRows.forEach(row => {
        const journalCell = row.cells[3];
        if (journalCell) {
            const journal = journalCell.textContent.trim();
            if (journal) {
                stats.journals[journal] = (stats.journals[journal] || 0) + 1;
            }
        }
        const detailRow = row.nextElementSibling;
        if (detailRow && detailRow.classList.contains('detail-row')) {
            const keywordsPara = detailRow.querySelector('.detail-metadata p strong');
            if (keywordsPara && keywordsPara.textContent.trim() === 'Keywords:') {
                const keywordsParent = keywordsPara.parentElement;
                if (keywordsParent) {
                    let keywordsText = keywordsParent.textContent.trim();
                    const prefix = "Keywords:";
                    if (keywordsText.startsWith(prefix)) {
                        keywordsText = keywordsText.substring(prefix.length).trim();
                    }
                    const keywordsList = keywordsText.split(';')
                        .map(kw => kw.trim())
                        .filter(kw => kw.length > 0);
                    keywordsList.forEach(keyword => {
                        stats.keywords[keyword] = (stats.keywords[keyword] || 0) + 1;
                    });
                }
            }
        }
        let authorsList = [];
        const detailRowForAuthors = row.nextElementSibling;
        if (detailRowForAuthors && detailRowForAuthors.classList.contains('detail-row')) {
            const authorsPara = Array.from(detailRowForAuthors.querySelectorAll('.detail-metadata p')).find(p => {
                const strongTag = p.querySelector('strong');
                return strongTag && strongTag.textContent.trim() === 'Full Authors:';
            });
            if (authorsPara) {
                let authorsText = authorsPara.textContent.trim();
                const prefix = "Full Authors:";
                if (authorsText.startsWith(prefix)) {
                    authorsText = authorsText.substring(prefix.length).trim();
                }
                if (authorsText) {
                    authorsList = authorsText.split(';')
                        .map(author => author.trim())
                        .filter(author => author.length > 0);
                } else {
                    console.warn("Found 'Full Authors:' paragraph but no author text following it.", row);
                }
            }
        }
        authorsList.forEach(author => {
            stats.authors = stats.authors || {};
            stats.authors[author] = (stats.authors[author] || 0) + 1;
        });

        const detailRowForResearchArea = row.nextElementSibling;
        if (detailRowForResearchArea && detailRowForResearchArea.classList.contains('detail-row')) {
            const researchAreaInput = detailRowForResearchArea.querySelector('.detail-edit input[name="research_area"]');
            if (researchAreaInput) {
                const researchArea = researchAreaInput.value.trim();
                if (researchArea) {
                    stats.researchAreas[researchArea] = (stats.researchAreas[researchArea] || 0) + 1;
                }
            }
        }

        // --- New Logic for Other Detected Features ---
        const detailRowForOtherFeature = row.nextElementSibling;
        if (detailRowForOtherFeature && detailRowForOtherFeature.classList.contains('detail-row')) {
            const otherFeatureInput = detailRowForOtherFeature.querySelector('.detail-edit input[name="features_other"]');
            if (otherFeatureInput) {
                const otherFeatureText = otherFeatureInput.value.trim();
                if (otherFeatureText) {
                    // Split by semicolon, trim, filter out empty strings
                    const featuresList = otherFeatureText.split(';')
                        .map(f => f.trim())
                        .filter(f => f.length > 0);

                    featuresList.forEach(feature => {
                        // Count occurrences of each feature string
                        stats.otherDetectedFeatures[feature] = (stats.otherDetectedFeatures[feature] || 0) + 1;
                    });
                }
            }
        }

        // --- New Logic for Model Names ---
        const detailRowForModelName = row.nextElementSibling;
        if (detailRowForModelName && detailRowForModelName.classList.contains('detail-row')) {
            const modelNameInput = detailRowForModelName.querySelector('.detail-edit input[name="model_name"]');
            if (modelNameInput) {
                const modelNameText = modelNameInput.value.trim();
                if (modelNameText) {
                    // Assuming model names might also be separated by ';' (adjust if needed)
                    const modelNamesList = modelNameText.split(';')
                        .map(m => m.trim())
                        .filter(m => m.length > 0);

                    modelNamesList.forEach(modelName => {
                        // Count occurrences of each model name string
                        stats.modelNames[modelName] = (stats.modelNames[modelName] || 0) + 1;
                    });
                }
            }
        }


    });
    return stats;
}

function displayStats() {

    updateCounts(); // Run updateCounts to get the latest data for visible rows

    // --- Define Consistent Colors for Techniques ---
    // Define the fixed color order used in the Techniques Distribution chart (sorted)
    const techniquesColors = [
        'hsla(347, 70%, 49%, 0.66)', // Red - Classic CV
        'hsla(204, 82%, 37%, 0.66)',  // Blue - Traditional ML
        'hsla(42, 100%, 37%, 0.66)',  // Yellow - CNN Classifier
        'hsla(180, 48%, 32%, 0.66)',  // Teal - CNN Detector
        'hsla(260, 80%, 50%, 0.66)', // Purple - R-CNN Detector
        'hsla(30, 100%, 43%, 0.66)',  // Orange - Transformer
        'hsla(0, 0%, 48%, 0.66)',  // Grey - Other DL
        'hsla(96, 100%, 29%, 0.66)', // Green - Hybrid
    ];
    const techniquesBorderColors = [
        'hsla(347, 70%, 29%, 1.00)',
        'hsla(204, 82%, 18%, 1.00)',
        'hsla(42, 100%, 18%, 1.00)',
        'hsla(180, 48%, 18%, 1.00)',
        'hsla(260, 100%, 30%, 1.00)',
        'hsla(30, 100%, 23%, 1.00)',
        'hsla(0, 0%, 28%, 1.00)',
        'hsla(147, 48%, 18%, 1.00)',
    ];

    // Map technique fields to their *original* color index in the unsorted list
    // IMPORTANT: This list must match the order of TECHNIQUE_FIELDS_FOR_YEARLY
    const TECHNIQUE_FIELDS_FOR_YEARLY = [
        'technique_classic_cv_based', 'technique_ml_traditional',
        'technique_dl_cnn_classifier', 'technique_dl_cnn_detector', 'technique_dl_rcnn_detector',
        'technique_dl_transformer', 'technique_dl_other', 'technique_hybrid'
    ];
    const TECHNIQUE_FIELD_COLOR_MAP = {};
    TECHNIQUE_FIELDS_FOR_YEARLY.forEach((field, index) => {
        TECHNIQUE_FIELD_COLOR_MAP[field] = index; // Map field to its original index
    });

    // --- Define Consistent Colors for Features ---
    // These are the original colors used in the Features Distribution chart (in original order)
    // Note: There are 10 features but only 4 distinct colors used.
    const featuresColorsOriginalOrder = [
        'hsla(180, 48%, 32%, 0.66)',    // 0 - PCB - Tracks (Teal)
        'hsla(180, 48%, 32%, 0.66)',    // 1 - PCB - Holes (Teal)
        'hsla(0, 0%, 48%, 0.66)',       // 2 - solder - Insufficient (Grey)
        'hsla(0, 0%, 48%, 0.66)',       // 3 - solder - Excess (Grey)
        'hsla(0, 0%, 48%, 0.66)',       // 4 - solder - Void (Grey)
        'hsla(0, 0%, 48%, 0.66)',       // 5 - solder - Crack (Grey)
        'hsla(347, 70%, 49%, 0.66)',    // 6 - PCBA - Orientation (Red)
        'hsla(347, 70%, 49%, 0.66)',    // 7 - PCBA - Missing Comp (Red)
        'hsla(347, 70%, 49%, 0.66)',    // 8 - PCBA - Wrong Comp (Red)
        'hsla(204, 82%, 37%, 0.66)',    // 9 - Cosmetic (Blue)
        'hsla(284, 82%, 37%, 0.66)',    // 10 - Other 
    ];
    const featuresBorderColorsOriginalOrder = [
        'hsla(204, 82%, 18%, 1.00)',    // 0 - PCB - Tracks
        'hsla(204, 82%, 18%, 1.00)',    // 1 - PCB - Holes
        'hsla(0, 0%, 28%, 1.00)',       // 2 - solder - Insufficient
        'hsla(0, 0%, 28%, 1.00)',       // 3 - solder - Excess
        'hsla(0, 0%, 28%, 1.00)',       // 4 - solder - Void
        'hsla(0, 0%, 28%, 1.00)',       // 5 - solder - Crack
        'hsla(347, 70%, 29%, 1.00)',    // 6 - PCBA - Orientation
        'hsla(347, 70%, 29%, 1.00)',    // 7 - PCBA - Missing Comp
        'hsla(347, 70%, 29%, 1.00)',    // 8 - PCBA - Wrong Comp
        'hsla(219, 100%, 30%, 1.00)',   // 9 - Cosmetic
        'hsla(284, 82%, 37%, 1.00)',    // 10 - Other 
    ];

    // Map feature fields to their *original* index in the unsorted list
    // IMPORTANT: This list must match the order of FEATURE_FIELDS_FOR_YEARLY
    const FEATURE_FIELDS_FOR_YEARLY = [
        'features_tracks', 'features_holes', 'features_solder_insufficient', 'features_solder_excess',
        'features_solder_void', 'features_solder_crack', 'features_orientation', 'features_wrong_component',
        'features_missing_component', 'features_cosmetic', 'features_other_state'
    ];
    const FEATURE_FIELD_INDEX_MAP = {};
    FEATURE_FIELDS_FOR_YEARLY.forEach((field, index) => {
        FEATURE_FIELD_INDEX_MAP[field] = index; // Map field to its original index
    });

    // --- Map Feature Fields to their Color Groups for Line Chart ---
    // Define the distinct color groups for the line chart based on original colors
    // The keys are the indices in the original color arrays that represent unique colors
    const featureColorGroups = {
        0: { label: 'PCB Features', fields: [] },      // Teal
        2: { label: 'Solder Defects', fields: [] },    // Grey
        6: { label: 'PCBA Issues', fields: [] },       // Red
        9: { label: 'Cosmetic', fields: [] },          // Blue
        10: { label: 'Other', fields: [] }
    };

    // Populate the groups with the actual feature fields
    FEATURE_FIELDS_FOR_YEARLY.forEach(field => {
        const originalIndex = FEATURE_FIELD_INDEX_MAP[field];
        const originalColorHSLA = featuresColorsOriginalOrder[originalIndex];

        // Find the base color index (0, 2, 6, 9) that matches this feature's color
        let baseColorIndex = null;
        for (let key in featureColorGroups) {
            const keyIndex = parseInt(key);
            if (featuresColorsOriginalOrder[keyIndex] === originalColorHSLA) {
                baseColorIndex = keyIndex;
                break;
            }
        }

        if (baseColorIndex !== null && featureColorGroups[baseColorIndex]) {
            featureColorGroups[baseColorIndex].fields.push(field);
        } else {
            console.warn(`Could not find matching base color for feature ${field}`);
        }
    });


    const FEATURE_FIELDS = [
        'features_tracks', 'features_holes', 'features_solder_insufficient',
        'features_solder_excess', 'features_solder_void', 'features_solder_crack',
        'features_orientation', 'features_missing_component', 'features_wrong_component',
        'features_cosmetic', 'features_other_state'
    ];
    // Include Datasets here temporarily to get the label mapping easily,
    // then filter it out for data/labels for the Techniques chart
    const TECHNIQUE_FIELDS_ALL = [
        'technique_classic_cv_based', 'technique_ml_traditional',
        'technique_dl_cnn_classifier', 'technique_dl_cnn_detector', 'technique_dl_rcnn_detector',
        'technique_dl_transformer', 'technique_dl_other', 'technique_hybrid',
        'technique_available_dataset' // Included to get label easily
    ];
    // Map NEW field names (data-field values / structure keys) to user-friendly labels (based on your table headers)
    const FIELD_LABELS = {
        // Features
        'features_tracks': 'Tracks',
        'features_holes': 'Holes',
        'features_solder_insufficient': 'Insufficient Solder',
        'features_solder_excess': 'Excess Solder',
        'features_solder_void': 'Solder Voids',
        'features_solder_crack': 'Solder Cracks',
        'features_orientation': 'Orientation/Polarity', // Combined as per previous logic
        'features_wrong_component': 'Wrong Component',
        'features_missing_component': 'Missing Component',
        'features_cosmetic': 'Cosmetic',
        'features_other_state': 'Other',
        // Techniques
        'technique_classic_cv_based': 'Classic CV',
        'technique_ml_traditional': 'Traditional ML',
        'technique_dl_cnn_classifier': 'CNN Classifier',
        'technique_dl_cnn_detector': 'CNN Detector',
        'technique_dl_rcnn_detector': 'R-CNN Detector',
        'technique_dl_transformer': 'Transformer',
        'technique_dl_other': 'Other DL',
        'technique_hybrid': 'Hybrid',
        'technique_available_dataset': 'Datasets' // Label for Datasets
    };


    // --- Read Counts from Footer Cells ---
    // We read the counts directly from the cells updated by updateCounts()
    function getCountFromFooter(fieldId) {
        const cell = document.getElementById(`count-${fieldId}`);
        if (cell) {
            const text = cell.textContent.trim();
            const number = parseInt(text, 10);
            return isNaN(number) ? 0 : number;
        }
        return 0;
    }

    // --- Prepare Features Distribution Chart Data (in original order) ---
    const featuresLabels = FEATURE_FIELDS.map(field => FIELD_LABELS[field] || field);
    const featuresValues = FEATURE_FIELDS.map(field => getCountFromFooter(field));

    const featuresChartData = {
        labels: featuresLabels,
        datasets: [{
            label: 'Features Count',
            data: featuresValues,
            backgroundColor: featuresColorsOriginalOrder, // Use original colors
            borderColor: featuresBorderColorsOriginalOrder, // Use original border colors
            borderWidth: 1,
            hoverOffset: 4
        }]
    };

    // --- Prepare Techniques Distribution Chart Data (Excluding Datasets count) ---
    const TECHNIQUE_FIELDS_NO_DATASET = TECHNIQUE_FIELDS_ALL.filter(field => field !== 'technique_available_dataset');
    // Read and sort the data for the distribution chart
    const techniquesData = TECHNIQUE_FIELDS_NO_DATASET.map(field => ({
        label: FIELD_LABELS[field] || field,
        value: getCountFromFooter(field),
        originalIndex: TECHNIQUE_FIELD_COLOR_MAP[field] !== undefined ? TECHNIQUE_FIELD_COLOR_MAP[field] : -1 // Get original color index
    }));
    // Sort by value descending (largest first) for the distribution chart display
    techniquesData.sort((a, b) => b.value - a.value);
    // Extract sorted labels and values
    const sortedTechniquesLabels = techniquesData.map(item => item.label);
    const sortedTechniquesValues = techniquesData.map(item => item.value);
    // Map the sorted order back to the original colors using the stored originalIndex
    const sortedTechniquesBackgroundColors = techniquesData.map(item => techniquesColors[item.originalIndex] || 'rgba(0,0,0,0.1)');
    const sortedTechniquesBorderColors = techniquesData.map(item => techniquesBorderColors[item.originalIndex] || 'rgba(0,0,0,1)');

    const techniquesChartData = {
        labels: sortedTechniquesLabels,
        datasets: [{
            label: 'Techniques Count',
            data: sortedTechniquesValues,
            backgroundColor: sortedTechniquesBackgroundColors, // Use mapped colors
            borderColor: sortedTechniquesBorderColors,         // Use mapped colors
            borderWidth: 1,
            hoverOffset: 4
        }]
    };

    // --- Destroy existing charts if they exist (important for re-renders) ---
    if (window.featuresPieChartInstance) {
        window.featuresPieChartInstance.destroy();
        delete window.featuresPieChartInstance;
    }
    if (window.techniquesPieChartInstance) {
        window.techniquesPieChartInstance.destroy();
        delete window.techniquesPieChartInstance;
    }
    if (window.surveyVsImplLineChartInstance) {
        window.surveyVsImplLineChartInstance.destroy();
        delete window.surveyVsImplLineChartInstance;
    }
    if (window.techniquesPerYearLineChartInstance) {
        window.techniquesPerYearLineChartInstance.destroy();
        delete window.techniquesPerYearLineChartInstance;
    }
    if (window.featuresPerYearLineChartInstance) {
        window.featuresPerYearLineChartInstance.destroy();
        delete window.featuresPerYearLineChartInstance;
    }


    
    // --- Get Canvas Contexts for ALL charts ---
    const featuresCtx = document.getElementById('featuresPieChart')?.getContext('2d');
    const techniquesCtx = document.getElementById('techniquesPieChart')?.getContext('2d');
    const surveyVsImplCtx = document.getElementById('surveyVsImplLineChart')?.getContext('2d');
    const techniquesPerYearCtx = document.getElementById('techniquesPerYearLineChart')?.getContext('2d');
    const featuresPerYearCtx = document.getElementById('featuresPerYearLineChart')?.getContext('2d');

    // --- Render Features Distribution Bar Chart (unchanged logic) ---
    if (featuresCtx) {
        window.featuresPieChartInstance = new Chart(featuresCtx, {
            type: 'bar',
            data: featuresChartData,
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return `${context.label}: ${context.raw}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: { precision: 0 }
                    }
                }
            }
        });
    } else {
        console.warn("Canvas context for featuresPieChart not found.");
    }

    // --- Render Techniques Distribution Bar Chart (using mapped colors) ---
    if (techniquesCtx) {
        window.techniquesPieChartInstance = new Chart(techniquesCtx, {
            type: 'bar',
            data: techniquesChartData, // Uses sortedTechniques* with mapped colors
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return `${context.label}: ${context.raw}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: { precision: 0 }
                    }
                }
            }
        });
    } else {
        console.warn("Canvas context for techniquesPieChart not found.");
    }

    // --- NEW: Render Line Charts ---

    // 1. Survey vs Implementation Papers per Year (unchanged)
    const surveyImplData = latestYearlyData.surveyImpl || {};
    const yearsForSurveyImpl = Object.keys(surveyImplData).map(Number).sort((a, b) => a - b);
    const surveyCounts = yearsForSurveyImpl.map(year => surveyImplData[year].surveys || 0);
    const implCounts = yearsForSurveyImpl.map(year => surveyImplData[year].impl || 0);

    if (surveyVsImplCtx) {
        window.surveyVsImplLineChartInstance = new Chart(surveyVsImplCtx, {
            type: 'line',
            data: {
                labels: yearsForSurveyImpl,
                datasets: [
                    {
                        label: 'Survey Papers',
                        data: surveyCounts,
                        borderColor: 'hsl(204, 82%, 37%)', // Blue
                        backgroundColor: 'hsla(204, 82%, 37%, 0.66)',
                        fill: false,
                        tension: 0.25
                    },
                    {
                        label: 'Implementation Papers',
                        data: implCounts,
                        borderColor: 'hsl(347, 70%, 49%)', // Red
                        backgroundColor: 'hsla(347, 70%, 49%, 0.66)',
                        fill: false,
                        tension: 0.25
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            usePointStyle: true,  // Use the point style
                            pointStyle: 'circle'  // Specify the circle style
                        }
                    },
                    title: { display: false, text: 'Survey vs Implementation Papers per Year' },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return `${context.dataset.label}: ${context.raw}`;
                            }
                        }
                    }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } },
                    x: { ticks: { precision: 0 } }
                }
            }
        });
    }

    // 2. Techniques per Year (Consistent Colors)
    const techniquesYearlyData = latestYearlyData.techniques || {};
    const yearsForTechniques = Object.keys(techniquesYearlyData).map(Number).sort((a, b) => a - b);

    // Create datasets for the line chart using the ORIGINAL field order and ORIGINAL colors
    // This ensures color consistency regardless of sorting in the bar chart
    const techniqueLineDatasets = TECHNIQUE_FIELDS_FOR_YEARLY.map(field => {
        const label = (typeof FIELD_LABELS !== 'undefined' && FIELD_LABELS[field]) ? FIELD_LABELS[field] : field;
        const data = yearsForTechniques.map(year => techniquesYearlyData[year]?.[field] || 0);
        // Use the ORIGINAL color index from the map
        const originalIndex = TECHNIQUE_FIELD_COLOR_MAP[field] !== undefined ? TECHNIQUE_FIELD_COLOR_MAP[field] : -1;
        const borderColor = (originalIndex !== -1 && techniquesColors[originalIndex]) ? techniquesColors[originalIndex] : 'rgba(0, 0, 0, 1)';
        const backgroundColor = (originalIndex !== -1 && techniquesColors[originalIndex]) ? techniquesColors[originalIndex] : 'rgba(0, 0, 0, 0.1)';
        return {
            label: label,
            data: data,
            borderColor: borderColor,       // Use original consistent color
            backgroundColor: backgroundColor, // Use original consistent color (often transparent for lines)
            fill: false,
            tension: 0.25
        };
    });

    if (techniquesPerYearCtx && techniqueLineDatasets.length > 0) {
        window.techniquesPerYearLineChartInstance = new Chart(techniquesPerYearCtx, {
            type: 'line',
            data: {
                labels: yearsForTechniques, // Use years sorted
                datasets: techniqueLineDatasets // Use datasets prepared with consistent colors
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            usePointStyle: true,  // Use the point style
                            pointStyle: 'circle'  // Specify the circle style
                        }
                    },
                    title: { display: false, text: 'Techniques per Year' },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return `${context.dataset.label}: ${context.raw}`;
                            }
                        }
                    }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } },
                    x: { ticks: { precision: 0 } }
                }
            }
        });
    } else if (techniquesPerYearCtx) {
        window.techniquesPerYearLineChartInstance = new Chart(techniquesPerYearCtx, {
            type: 'line',
            data: { labels: [], datasets: [] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: 'Techniques per Year (No Data)' }
                }
            }
        });
    }

    // 3. Features per Year (Summed by Color Group)
    const featuresYearlyData = latestYearlyData.features || {};
    const yearsForFeatures = Object.keys(featuresYearlyData).map(Number).sort((a, b) => a - b);

    // --- Create Aggregated Data by Color Group ---
    // Aggregate yearly data for each color group
    const aggregatedFeatureDataByColor = {};
    Object.keys(featureColorGroups).forEach(baseColorIndex => {
        const group = featureColorGroups[baseColorIndex];
        aggregatedFeatureDataByColor[group.label] = yearsForFeatures.map(year => {
            return group.fields.reduce((sum, field) => {
                return sum + (featuresYearlyData[year]?.[field] || 0);
            }, 0);
        });
    });

    // Create datasets for the line chart using the aggregated data and corresponding colors
    const featureLineDatasets = Object.keys(featureColorGroups).map(baseColorIndex => {
        const group = featureColorGroups[baseColorIndex];
        const colorIndex = parseInt(baseColorIndex); // Use the base color index to get the actual color
        const borderColor = (featuresColorsOriginalOrder[colorIndex]) ? featuresColorsOriginalOrder[colorIndex] : 'rgba(0, 0, 0, 1)';
        const backgroundColor = (featuresColorsOriginalOrder[colorIndex]) ? featuresColorsOriginalOrder[colorIndex] : 'rgba(0, 0, 0, 0.1)';
        return {
            label: group.label,
            data: aggregatedFeatureDataByColor[group.label],
            borderColor: borderColor,       // Use color corresponding to the group's base color
            backgroundColor: backgroundColor, // Use color corresponding to the group's base color
            fill: false,
            tension: 0.25
        };
    });

    if (featuresPerYearCtx && featureLineDatasets.length > 0) {
        window.featuresPerYearLineChartInstance = new Chart(featuresPerYearCtx, {
            type: 'line',
            data: {
                labels: yearsForFeatures, // Use years sorted
                datasets: featureLineDatasets // Use datasets prepared with aggregated data and consistent colors
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            usePointStyle: true,  // Use the point style
                            pointStyle: 'circle'  // Specify the circle style
                        }
                    },
                    title: { display: false, text: 'Features per Year' },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return `${context.dataset.label}: ${context.raw}`;
                            }
                        }
                    }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } },
                    x: { ticks: { precision: 0 } }
                }
            }
        });
    } else if (featuresPerYearCtx) {
        window.featuresPerYearLineChartInstance = new Chart(featuresPerYearCtx, {
            type: 'line',
            data: { labels: [], datasets: [] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: 'Features per Year (No Data)' }
                }
            }
        });
    }

    // --- 4. Publication Types per Year ---
    const pubTypesYearlyData = latestYearlyData.pubTypes || {};
    const yearsForPubTypes = Object.keys(pubTypesYearlyData).map(Number).sort((a, b) => a - b);

    // --- Aggregate data for the chart ---
    // Get all unique publication types across all years
    const allPubTypesSet = new Set();
    Object.values(pubTypesYearlyData).forEach(yearData => {
        Object.keys(yearData).forEach(type => allPubTypesSet.add(type));
    });
    const allPubTypes = Array.from(allPubTypesSet).sort(); // Sort for consistent legend order

    // Create datasets for the line chart, one for each publication type
    const pubTypeLineDatasets = allPubTypes.map((type, index) => {
        // Generate a distinct color for each type (simple hue rotation)
        // You might want to use a more sophisticated color palette
        const hue = (index * 137.508) % 360; // Golden angle approximation for spread
        const borderColor = `hsl(${hue}, 50%, 50%)`; 
        const backgroundColor = `hsla(${hue}, 60%, 45%, 0.5)`; 

        const data = yearsForPubTypes.map(year => pubTypesYearlyData[year]?.[type] || 0);
        return {
            label: type, // Use the raw type name as label (or map if needed)
            data: data,
            borderColor: borderColor,
            backgroundColor: backgroundColor,
            fill: false,
            tension: 0.25,
            hidden: false // Start visible
        };
    });

    // --- Render the Publication Types per Year Line Chart ---
    const pubTypesPerYearCtx = document.getElementById('pubTypesPerYearLineChart')?.getContext('2d');
    if (window.pubTypesPerYearLineChartInstance) {
        window.pubTypesPerYearLineChartInstance.destroy();
        delete window.pubTypesPerYearLineChartInstance;
    }

    if (pubTypesPerYearCtx && pubTypeLineDatasets.length > 0) {
        window.pubTypesPerYearLineChartInstance = new Chart(pubTypesPerYearCtx, {
            type: 'line',
            data: {
                labels: yearsForPubTypes, // Use sorted years
                datasets: pubTypeLineDatasets // Use datasets prepared above
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            usePointStyle: true,
                            pointStyle: 'circle'
                        }
                    },
                    title: { display: false, text: 'Publication Types per Year' },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return `${context.dataset.label}: ${context.raw}`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { precision: 0 },
                        title: {
                            display: true,
                            text: 'Count'
                        }
                    },
                    x: {
                        ticks: { precision: 0 },
                        title: {
                            display: false,
                            text: 'Year'
                        }
                    }
                }
            }
        });
    } else if (pubTypesPerYearCtx) {
        // Handle case where there's no data
        window.pubTypesPerYearLineChartInstance = new Chart(pubTypesPerYearCtx, {
            type: 'line',
            data: { labels: [], datasets: [] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: 'Publication Types per Year (No Data)' }
                }
            }
        });
    }
    const stats = calculateStats();

    // --- New Function Call to Populate Lists ---
    // Function to populate lists where items *can* appear only once (no > 1 filter)
    function populateSimpleList(listElementId, dataObj) {
        const listElement = document.getElementById(listElementId);
        listElement.innerHTML = '';
        // Sort entries: primarily by count (descending), then alphabetically (ascending) for ties
        const sortedEntries = Object.entries(dataObj)
            .sort((a, b) => {
                if (b[1] !== a[1]) {
                    return b[1] - a[1]; // Sort by count descending
                }
                return a[0].localeCompare(b[0]); // Sort alphabetically ascending if counts are equal
            });

        if (sortedEntries.length === 0) {
            listElement.innerHTML = '<li>No items found.</li>';
            return;
        }

        sortedEntries.forEach(([name, count]) => {
            const listItem = document.createElement('li');
            // Escape HTML to prevent XSS if data contains special characters
            const escapedName = name.replace(/&/g, "&amp;").replace(/</g, "<").replace(/>/g, ">");
            listItem.innerHTML = `<span class="count">${count}</span> <span class="name">${escapedName}</span>`;
            listElement.appendChild(listItem);
        });
    }

    // Populate the new lists using the new helper function
    populateSimpleList('otherDetectedFeaturesStatsList', stats.otherDetectedFeatures);
    populateSimpleList('modelNamesStatsList', stats.modelNames);

    function populateList(listElementId, dataObj) {
        const listElement = document.getElementById(listElementId);
        listElement.innerHTML = '';
        const sortedEntries = Object.entries(dataObj)
            .filter(([name, count]) => count > 1)
            .sort((a, b) => {
                if (b[1] !== a[1]) {
                    return b[1] - a[1];
                }
                return a[0].localeCompare(b[0]);
            });
        if (sortedEntries.length === 0) {
            listElement.innerHTML = '<li>No items with count > 1.</li>';
            return;
        }
        sortedEntries.forEach(([name, count]) => {
            const listItem = document.createElement('li');
            const escapedName = name.replace(/&/g, "&amp;").replace(/</g, "<").replace(/>/g, ">");
            listItem.innerHTML = `<span class="count">${count}</span> <span class="name">${escapedName}</span>`;
            listElement.appendChild(listItem);
        });
    }
    populateList('journalStatsList', stats.journals);
    populateList('keywordStatsList', stats.keywords);
    populateList('authorStatsList', stats.authors);
    populateList('researchAreaStatsList', stats.researchAreas);

    modal.offsetHeight;
    modal.classList.add('modal-active');
}

function displayAbout(){
    setTimeout(() => {
        modalSmall.offsetHeight;
        modalSmall.classList.add('modal-active');
    }, 20);
}
function closeModal() { modal.classList.remove('modal-active'); }
function closeSmallModal() { modalSmall.classList.remove('modal-active'); }


document.addEventListener('DOMContentLoaded', function () {

    searchInput.addEventListener('input', scheduleFilterUpdate);
    hideOfftopicCheckbox.addEventListener('change', scheduleFilterUpdate);
    minPageCountInput.addEventListener('input', scheduleFilterUpdate);
    minPageCountInput.addEventListener('change', scheduleFilterUpdate);
    yearFromInput.addEventListener('input', scheduleFilterUpdate);
    yearFromInput.addEventListener('change', scheduleFilterUpdate);
    yearToInput.addEventListener('input', scheduleFilterUpdate);
    yearToInput.addEventListener('change', scheduleFilterUpdate);
    hideXrayCheckbox.addEventListener('change', scheduleFilterUpdate);
    hideApprovedCheckbox.addEventListener('change', scheduleFilterUpdate);
    onlySurveyCheckbox.addEventListener('change', scheduleFilterUpdate);
    
    showPCBcheckbox.addEventListener('change', scheduleFilterUpdate);
    showSolderCheckbox.addEventListener('change', scheduleFilterUpdate);
    showPCBAcheckbox.addEventListener('change', scheduleFilterUpdate);

    headers.forEach(header => { header.addEventListener('click', sortTable); });
    statsBtn.addEventListener('click', function () {
        document.documentElement.classList.add('busyCursor');
        setTimeout(() => {
            displayStats();
            document.documentElement.classList.remove('busyCursor');
        }, 10);
    });
    aboutBtn.addEventListener('click', displayAbout);
    
    scheduleFilterUpdate();

    // --- Close Modal
    spanClose.addEventListener('click', closeModal);
    smallClose.addEventListener('click', closeSmallModal);
    document.addEventListener('keydown', function (event) {
        // Check if the pressed key is 'Escape' and if the modal is currently active
        if (event.key === 'Escape') { closeModal(); closeSmallModal(); }
    });
    window.addEventListener('click', function (event) {
        if (event.target === modal || event.target === modalSmall) { closeModal(); closeSmallModal(); }
    });

    setTimeout(() => {
        document.documentElement.classList.add('busyCursor');
        const commentedHeader = document.querySelector('th[data-sort="user_comment_state"]');
        // Set the initial sort state so the UI indicator is correct
        currentClientSort = { column: "user_comment_state", direction: 'DESC' };
        
        // Call sortTable with the correct 'this' context (the header element)
        // We need to bind 'this' or call it directly on the element
        sortTable.call(commentedHeader);

        // Update the sort indicator visually
        // Clear previous indicators
        document.querySelectorAll('th .sort-indicator').forEach(ind => ind.textContent = '');
        // Set the indicator on the target header
        const indicator = commentedHeader.querySelector('.sort-indicator');
        // Use '▼' for DESC, '▲' for ASC based on your sortTable logic
        indicator.textContent = currentClientSort.direction === 'ASC' ? '▲' : '▼';
        document.documentElement.classList.remove('busyCursor');
    }, 20); // Ensures it runs after applyLocalFilters' timeout finishes
});