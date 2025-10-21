// static/filtering.js
/** This file contains client-side filtering code, shared between server-based full page and client-only HTML export.
 */

// Hardocoded cells - used for multiple scripts:
const pdfCellIndex = 0;
const titleCellIndex = 1;
const yearCellIndex = 2;
const pageCountCellIndex = 3;
const journalCellIndex = 4;
const typeCellIndex = 5;
const relevanceCellIndex = 7;
const estScoreCellIndex = 38;

const searchInput = document.getElementById('search-input');
const hideOfftopicCheckbox = document.getElementById('hide-offtopic-checkbox');
const hideXrayCheckbox = document.getElementById('hide-xray-checkbox');
const hideApprovedCheckbox = document.getElementById('hide-approved-checkbox');
const onlySurveyCheckbox = document.getElementById('only-survey-checkbox');
const showPCBcheckbox = document.getElementById('show-pcb-checkbox');
const showSolderCheckbox = document.getElementById('show-solder-checkbox');
const showPCBAcheckbox = document.getElementById('show-pcba-checkbox');
const noFeaturesCheckbox = document.getElementById('no-features-checkbox');
const showOtherCheckbox = document.getElementById('show-other-checkbox');

let filterTimeoutId = null;
const FILTER_DEBOUNCE_DELAY = 250;

const headers = document.querySelectorAll('th[data-sort]');
let currentClientSort = { column: null, direction: 'ASC' };

// Pre-compiled regular expressions for search (if needed)
let searchRegex = null;
let searchTerms = [];

const SYMBOL_SORT_WEIGHTS = {
    '✔️': 2,
    '❌': 1,
    '❔': 0
};

const SYMBOL_PDF_WEIGHTS = {
    '📗': 3, // Annotated
    '📕': 2, // PDF
    '❔': 1,  // None
    '💰': 0 // Paywalled
};

// Cache frequently accessed elements
const tbody = document.querySelector('#papersTable tbody');
const duplicateCountElement = document.getElementById('duplicate-papers-count');

// Add the WeakMap for caching row data
const rowCache = new WeakMap();

/**
 * Applies alternating row shading to visible main rows.
 * Ensures detail rows follow their main row's shading.
 * Each "paper group" (main row + detail row) gets a single alternating color.
 * Should be pure client-side to be reused for HTML export
 */
function applyAlternatingShading() {
    // Use CSS classes to avoid inline style recalculation where possible
    const rows = tbody.querySelectorAll('tr[data-paper-id]:not(.filter-hidden)');
    let idx = 0;
    for (const main of rows) {
        const shade = (idx & 1) ? 'alt-shade-2' : 'alt-shade-1';
        main.classList.toggle('alt-shade-1', shade === 'alt-shade-1');
        main.classList.toggle('alt-shade-2', shade === 'alt-shade-2');

        const detail = main.nextElementSibling;
        if (detail) {
            detail.classList.toggle('alt-shade-1', shade === 'alt-shade-1');
            detail.classList.toggle('alt-shade-2', shade === 'alt-shade-2');
        }
        idx++;
    }
}

/**
 * Optimized duplicate shading using cached data and batch operations
 */
// Corrected version assuming 'rows' passed are the visible ones:
/**
 * Optimized duplicate shading using cached data and batch operations
 * @param {NodeList} visibleRows - The list of rows currently visible after filtering.
 */
function applyDuplicateShading(visibleRows) {
    // Use the rows parameter passed from applyLocalFilters
    const journalCounts = new Map();
    const titleCounts = new Map();

    // Count occurrences for both journal names and titles from visible rows
    for (let i = 0; i < visibleRows.length; i++) {
        const row = visibleRows[i];
        // Use rowCache.get(row) instead of row._cachedData
        const cachedData = rowCache.get(row);
        if (cachedData) { // Ensure cache exists for this row
            const journalName = cachedData.journalText;
            const title = cachedData.titleText;

            if (journalName) {
                journalCounts.set(journalName, (journalCounts.get(journalName) || 0) + 1);
            }
            if (title) {
                titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
            }
        }
    }

    // Count duplicate titles (only titles with 2 or more occurrences)
    let duplicateTitleCount = 0;
    for (const [title, count] of titleCounts) {
        if (title && count >= 2) {
            duplicateTitleCount++;
        }
    }

    // Update the duplicate papers count in HTML
    if (duplicateCountElement) {
        duplicateCountElement.textContent = duplicateTitleCount;
    }

    // Determine the maximum count for scaling (for journals only)
    let maxCount = 0;
    for (const count of journalCounts.values()) {
        if (count > maxCount) maxCount = count;
    }

    // Pre-calculate HSL strings to avoid repeated string operations
    const baseJournalHue = 210;
    const baseSaturation = 66;
    const minLightness = 96;
    const maxLightness = 84;

    const baseTitleHue = 0;
    const titleSaturation = 66;
    const titleLightness = 94;

    // Pre-calculate HSL strings for journals
    const journalHslStrings = new Map();
    for (const [journalName, count] of journalCounts) {
        if (count >= 2) {
            let lightness;
            if (maxCount <= 1) {
                lightness = minLightness;
            } else {
                lightness = maxLightness + (minLightness - maxLightness) * (1 - (count - 1) / (maxCount - 1));
                lightness = Math.max(maxLightness, Math.min(minLightness, lightness));
            }
            journalHslStrings.set(journalName, `hsl(${baseJournalHue}, ${baseSaturation}%, ${lightness}%)`);
        }
    }

    // Pre-calculate HSL string for titles
    const duplicateTitleHslString = `hsl(${baseTitleHue}, ${titleSaturation}%, ${titleLightness}%)`;

    // Apply shading in a single pass
    for (let i = 0; i < visibleRows.length; i++) {
        const row = visibleRows[i];
        const journalCell = row.cells[journalCellIndex];
        const titleCell = row.cells[titleCellIndex];

        // Reset background colors
        journalCell.style.backgroundColor = '';
        titleCell.style.backgroundColor = '';

        // Use rowCache.get(row) to get cached data
        const cachedData = rowCache.get(row);
        if (cachedData) { // Ensure cache exists
            const journalName = cachedData.journalText;
            const title = cachedData.titleText;

            // Apply journal shading (progressive)
            if (journalName && journalCounts.get(journalName) >= 2) {
                journalCell.style.backgroundColor = journalHslStrings.get(journalName);
            }

            // Apply title shading (consistent red for duplicates)
            if (title && titleCounts.get(title) >= 2) {
                titleCell.style.backgroundColor = duplicateTitleHslString;
            }
        }
    }
}
// --- Tri-State Survey Filter Logic (Add to globals.js) ---
// Define the states for the survey filter
const SURVEY_FILTER_STATES = {
    ALL: 'all',           // Default: Show all papers
    ONLY_SURVEYS: 'surveys', // Show only papers marked as surveys (✔️)
    ONLY_NON_SURVEYS: 'non_surveys' // Show only papers NOT marked as surveys (❌ or ❔)
};

// Store the current state of the survey filter
let currentSurveyFilterState = SURVEY_FILTER_STATES.ONLY_NON_SURVEYS; 

// Function to cycle the checkbox's visual state and update the title
function updateSurveyCheckboxUI() {
    const checkbox = onlySurveyCheckbox; // Reference from your globals
    const state = currentSurveyFilterState;

    // Remove any previous tri-state classes (if you add custom styling)
    checkbox.classList.remove('tri-state-indeterminate'); // Example class

    switch (state) {
        case SURVEY_FILTER_STATES.ALL:
            checkbox.checked = false;
            checkbox.indeterminate = false; // Ensure indeterminate is off
            checkbox.title = 'Currently showing all papers. Click to show only Survey papers';
            break;
        case SURVEY_FILTER_STATES.ONLY_SURVEYS:
            checkbox.checked = true; // Visually checked
            checkbox.indeterminate = false;
            checkbox.title = 'Currently showing only Surveys. Click to show only primary (non-survey) papers';
            break;
        case SURVEY_FILTER_STATES.ONLY_NON_SURVEYS:
            checkbox.checked = false; // Visually unchecked
            checkbox.indeterminate = true; // Use indeterminate to show the third state
            checkbox.title = 'Currently showing only primary (non-survey) papers. Click to show All papers';
            break;
    }
}

// Function to cycle the filter state on click
function cycleSurveyFilterState() {
    switch (currentSurveyFilterState) {
        case SURVEY_FILTER_STATES.ALL:
            currentSurveyFilterState = SURVEY_FILTER_STATES.ONLY_SURVEYS;
            break;
        case SURVEY_FILTER_STATES.ONLY_SURVEYS:
            currentSurveyFilterState = SURVEY_FILTER_STATES.ONLY_NON_SURVEYS;
            break;
        case SURVEY_FILTER_STATES.ONLY_NON_SURVEYS:
            currentSurveyFilterState = SURVEY_FILTER_STATES.ALL;
            break;
    }
    updateSurveyCheckboxUI();
    applyLocalFilters(); // Re-apply filters after state change
}

// Pre-calculate feature groups for faster lookups
const FEATURE_GROUPS = {
    pcb: ['features_tracks', 'features_holes', 'features_bare_pcb_other'],
    solder: [
        'features_solder_insufficient',
        'features_solder_excess',
        'features_solder_void',
        'features_solder_crack',
        'features_solder_other'
    ],
    pcba: [
        'features_orientation',
        'features_missing_component',
        'features_wrong_component',
        'features_component_other',
        'features_cosmetic',
        'features_other_state'
    ],
    other: ['features_other_state']
};

// Combine all feature fields into a single array for efficient iteration
const ALL_FEATURE_FIELDS = [
    ...FEATURE_GROUPS.pcb,
    ...FEATURE_GROUPS.solder,
    ...FEATURE_GROUPS.pcba,
    ...FEATURE_GROUPS.other
];

// Pre-compiled regex for search terms (if using regex search)
function compileSearchRegex(searchTerm) {
    if (!searchTerm) return null;
    try {
        // Split search term by spaces for AND matching
        const terms = searchTerm.split(/\s+/).filter(t => t.length > 0);
        searchTerms = terms.map(t => t.toLowerCase());
        return new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    } catch (e) {
        console.warn("Invalid search regex:", e);
        return null;
    }
}

let rafId = 0;
function applyLocalFilters() {
    clearTimeout(filterTimeoutId);
    document.documentElement.classList.add('busyCursor');
    cancelAnimationFrame(rafId)
    filterTimeoutId = setTimeout(() => { 
        // --- Pre-cache data for all rows to avoid repeated DOM queries ---
        const rows = tbody.querySelectorAll('tr[data-paper-id]');
        
        // Pre-calculate filter values outside the loop
        const hideXrayChecked = hideXrayCheckbox.checked;
        const hideApprovedChecked = hideApprovedCheckbox.checked;
        const showPCBChecked = showPCBcheckbox.checked;
        const showSolderChecked = showSolderCheckbox.checked;
        const showPCBAChecked = showPCBAcheckbox.checked;
        const showOtherChecked = showOtherCheckbox.checked;
        const showNoFeaturesChecked = noFeaturesCheckbox.checked;
        const hideOfftopicChecked = document.body.id === 'html-export' ? hideOfftopicCheckbox.checked : false;
        const minPageCountValue = document.body.id === 'html-export' ? (document.getElementById('min-page-count').value.trim() || 0) : 0;
        const yearFromValue = document.body.id === 'html-export' ? (document.getElementById('year-from').value.trim() || 0) : 0;
        const yearToValue = document.body.id === 'html-export' ? (document.getElementById('year-to').value.trim() || 0) : 0;
        const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
        const compiledSearchRegex = compileSearchRegex(searchTerm);

        // --- Cache data for all rows in a single pass ---
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            // Cache status cells
            const surveyCell = row.querySelector('.editable-status[data-field="is_survey"]');
            const xrayCell = row.querySelector('.editable-status[data-field="is_x_ray"]');
            const verifiedCell = row.querySelector('.editable-status[data-field="verified"]');
            const offtopicCell = row.querySelector('.editable-status[data-field="is_offtopic"]');

            // Cache feature cell values
            const featureValues = {};
            for (let j = 0; j < ALL_FEATURE_FIELDS.length; j++) {
                const fieldName = ALL_FEATURE_FIELDS[j];
                const cell = row.querySelector(`[data-field="${fieldName}"]`);
                featureValues[fieldName] = cell ? cell.textContent.trim() : '';
            }

            // Determine group membership based on cached feature values
            let hasPCBFeature = false;
            for (let j = 0; j < FEATURE_GROUPS.pcb.length; j++) {
                if (featureValues[FEATURE_GROUPS.pcb[j]] === '✔️') {
                    hasPCBFeature = true;
                    break;
                }
            }

            let hasSolderFeature = false;
            for (let j = 0; j < FEATURE_GROUPS.solder.length; j++) {
                if (featureValues[FEATURE_GROUPS.solder[j]] === '✔️') {
                    hasSolderFeature = true;
                    break;
                }
            }

            let hasPCBAFeature = false;
            for (let j = 0; j < FEATURE_GROUPS.pcba.length; j++) {
                if (featureValues[FEATURE_GROUPS.pcba[j]] === '✔️') {
                    hasPCBAFeature = true;
                    break;
                }
            }

            let hasOtherFeature = false;
            for (let j = 0; j < FEATURE_GROUPS.other.length; j++) {
                if (featureValues[FEATURE_GROUPS.other[j]] === '✔️') {
                    hasOtherFeature = true;
                    break;
                }
            }

            // Cache hidden data text
            let hiddenDataText = '';
            const hiddenDataCells = row.querySelectorAll('td.hidden-data-cell');
            for (let j = 0; j < hiddenDataCells.length; j++) {
                hiddenDataText += ' ' + (hiddenDataCells[j].textContent || '').toLowerCase();
            }

            // Cache main row text content (excluding hidden data cells)
            let visibleRowText = '';
            for (let j = 0; j < row.cells.length; j++) {
                if (!row.cells[j].classList.contains('hidden-data-cell')) {
                    visibleRowText += ' ' + row.cells[j].textContent.toLowerCase();
                }
            }

            // Cache frequently accessed text values
            const journalText = row.cells[journalCellIndex]?.textContent?.trim().toLowerCase() || '';
            const titleText = row.cells[titleCellIndex]?.textContent?.trim().toLowerCase() || '';

            // Store all cached data in the WeakMap using the row element as the key
            rowCache.set(row, {
                surveyStatus: surveyCell ? surveyCell.textContent.trim() : '❔',
                xrayStatus: xrayCell ? xrayCell.textContent.trim() : 'N/A',
                verifiedStatus: verifiedCell ? verifiedCell.textContent.trim() : 'N/A',
                offtopicStatus: offtopicCell ? offtopicCell.textContent.trim() : 'N/A',
                featureValues: featureValues,
                hasPCBFeature,
                hasSolderFeature,
                hasPCBAFeature,
                hasOtherFeature,
                hiddenDataText,
                visibleRowText,
                journalText,
                titleText,
                pageCount: row.cells[pageCountCellIndex]?.textContent?.trim() || '',
                year: row.cells[yearCellIndex]?.textContent?.trim() || ''
            });
        }
        /* ---------- 1.  shared batch containers ---------- */
        const toHide = [];
        const toShow = [];

        /* ---------- 2.  single walk over every <tr> using cached data ---------- */
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            // Get cached data from the WeakMap
            const cachedData = rowCache.get(row); // Use rowCache.get(row) instead of row._cachedData

            let showRow = true;

            /* ----------------------------------------------------
                2a.  HTML-export-only filters
            ---------------------------------------------------- */
            if (document.body.id === 'html-export') {
                if (showRow && hideOfftopicChecked) {
                    if (cachedData.offtopicStatus === '✔️') { // Access via cachedData
                        showRow = false;
                    }
                }

                if (showRow && minPageCountValue > 0) {
                    const pageCount = parseInt(cachedData.pageCount, 10); // Access via cachedData
                    if (!isNaN(pageCount) && pageCount < minPageCountValue) {
                        showRow = false;
                    }
                }

                if (showRow && (yearFromValue || yearToValue)) {
                    const year = cachedData.year ? parseInt(cachedData.year, 10) : NaN; // Access via cachedData
                    if (isNaN(year) || (yearFromValue && year < yearFromValue) || (yearToValue && year > yearToValue)) {
                        showRow = false;
                    }
                }
            }

            /* ----------------------------------------------------
                2b.  universal filters (search, survey, X-ray, …)
            ---------------------------------------------------- */
            // Search Term
            if (showRow && searchTerm) {
                // Fast string inclusion check first
                if (!cachedData.visibleRowText.includes(searchTerm) && !cachedData.hiddenDataText.includes(searchTerm)) { // Access via cachedData
                    showRow = false;
                }

                // If still showing, do more complex search if needed
                if (showRow && compiledSearchRegex) {
                    // Additional regex or multi-term checks if needed
                }
            }

            // Apply the tri-state survey filter logic
            if (showRow) {
                const surveyStatus = cachedData.surveyStatus; // Access via cachedData

                switch (currentSurveyFilterState) {
                    case SURVEY_FILTER_STATES.ONLY_SURVEYS:
                        if (surveyStatus !== '✔️') {
                            showRow = false;
                        }
                        break;
                    case SURVEY_FILTER_STATES.ONLY_NON_SURVEYS:
                        if (surveyStatus === '✔️') {
                            showRow = false;
                        }
                        break;
                    // For SURVEY_FILTER_STATES.ALL, showRow remains unchanged (default)
                }
            }

            // Existing filters (X-Ray, Survey, Approved)
            if (showRow && hideXrayChecked) {
                if (cachedData.xrayStatus === '✔️') { // Access via cachedData
                    showRow = false;
                }
            }
            if (showRow && hideApprovedChecked) {
                if (cachedData.verifiedStatus === '✔️') { // Access via cachedData
                    showRow = false;
                }
            }

            // --- Feature Group Filters ---
            if (showRow && (showPCBChecked || showSolderChecked || showPCBAChecked || showOtherChecked)) {
                if (!( (showPCBChecked && cachedData.hasPCBFeature) || // Access via cachedData
                        (showSolderChecked && cachedData.hasSolderFeature) || // Access via cachedData
                        (showPCBAChecked && cachedData.hasPCBAFeature) || // Access via cachedData
                        (showOtherChecked && cachedData.hasOtherFeature) )) {
                    showRow = false;
                }
            }

            // --- "No Features" Filter ---
            if (showRow && showNoFeaturesChecked) {
                let hasAnyFeatureFilled = false;
                for (let j = 0; j < ALL_FEATURE_FIELDS.length; j++) {
                    const cellText = cachedData.featureValues[ALL_FEATURE_FIELDS[j]]; // Access via cachedData
                    if (cellText !== '' && cellText !== '❌' && cellText !== '❔') {
                        hasAnyFeatureFilled = true;
                        break;
                    }
                }

                if (hasAnyFeatureFilled) {
                    showRow = false;
                }
            }

            /* ----------------------------------------------------
                2c.  queue the visibility change (no DOM touch yet)
            ---------------------------------------------------- */
            const detailRow = row.nextElementSibling;
            const hide = !showRow;

            if (row.classList.contains('filter-hidden') !== hide) {
                (hide ? toHide : toShow).push(row);
            }
            if (detailRow && detailRow.classList.contains('filter-hidden') !== hide) {
                (hide ? toHide : toShow).push(detailRow);
            }
        }

        /* ---------- 3.  one RAF to flush all changes ---------- */
        // Batch DOM operations
        for (let i = 0; i < toHide.length; i++) {
            toHide[i].classList.add('filter-hidden');
        }
        for (let i = 0; i < toShow.length; i++) {
            toShow[i].classList.remove('filter-hidden');
        }

        rafId = requestAnimationFrame(() => {       // 1 layout + 1 paint
            applyAlternatingShading();

            if (document.body.id !== 'html-export') {
                // Pass only visible rows to duplicate shading
                // const visibleRows = tbody.querySelectorAll('tr[data-paper-id]:not(.filter-hidden)'); // This line was already correct
                // Use the same query or the 'rows' variable if filtered correctly before the loop
                // It's better to get the visible rows *after* the visibility classes are applied
                // but *before* applyDuplicateShading runs. Since applyLocalFilters batch applies
                // visibility changes before the rAF, the query inside rAF will be accurate.
                const visibleRows = tbody.querySelectorAll('tr[data-paper-id]:not(.filter-hidden)');
                applyDuplicateShading(visibleRows); // Pass the NodeList
                const applyButton = document.getElementById('apply-serverside-filters');
                applyButton.style.opacity = '0';
                applyButton.style.pointerEvents = 'none';
            }
            updateCounts();
            document.documentElement.classList.remove('busyCursor');
        });
    }, FILTER_DEBOUNCE_DELAY);
}

// Pre-calculate sort column indices for faster lookups
const SORT_COLUMN_INDICES = {
    'title': titleCellIndex,
    'year': yearCellIndex,
    'journal': journalCellIndex,
    'page_count': pageCountCellIndex,
    'estimated_score': estScoreCellIndex,
    'relevance': relevanceCellIndex,
    'pdf-link': pdfCellIndex
};

function sortTable() {
    document.documentElement.classList.add('busyCursor');

    setTimeout(() => {
        const sortBy = this.getAttribute('data-sort');
        if (!sortBy) return;

        let newDirection = 'DESC';
        if (currentClientSort.column === sortBy) {
            newDirection = currentClientSort.direction === 'DESC' ? 'ASC' : 'DESC';
        }

        // --- PRE-PROCESS: Extract Sort Values and Row References ---
        // Get visible rows BEFORE sorting potentially changes their order in the DOM
        const visibleMainRows = tbody.querySelectorAll('tr[data-paper-id]:not(.filter-hidden)');
        const headerIndex = Array.prototype.indexOf.call(this.parentNode.children, this);
        const sortData = new Array(visibleMainRows.length);
        let sortIndex = 0;

        // Pre-calculate sort type to avoid repeated checks
        const isNumericSort = ['year', 'estimated_score', 'page_count', 'relevance'].includes(sortBy);
        const isStatusSort = !['title', 'year', 'journal', 'page_count', 'estimated_score', 'relevance', 'pdf-link'].includes(sortBy);

        for (let i = 0; i < visibleMainRows.length; i++) {
            const mainRow = visibleMainRows[i];
            const paperId = mainRow.getAttribute('data-paper-id');
            let cellValue;

            // --- Extract cell value based on column type ---
            if (isNumericSort) {
                const cell = mainRow.cells[headerIndex];
                cellValue = cell ? parseFloat(cell.textContent.trim()) || 0 : 0;
            } else if (sortBy === 'pdf-link') {
                const cell = mainRow.cells[headerIndex];
                cellValue = SYMBOL_PDF_WEIGHTS[cell?.textContent.trim()] ?? 0;
            } else if (isStatusSort) {
                const cell = mainRow.querySelector(`.editable-status[data-field="${sortBy}"]`);
                cellValue = SYMBOL_SORT_WEIGHTS[cell?.textContent.trim()] ?? 0;
            } else { // Text columns
                const cell = mainRow.cells[headerIndex];
                cellValue = cell ? cell.textContent.trim() : '';
            }

            // Use rowCache.get(mainRow) to get cached data for secondary sort key (if needed)
            // For example, if you wanted to use journalText or titleText for secondary sort on text columns:
            // const cachedData = rowCache.get(mainRow);
            // const secondarySortKey = cachedData ? cachedData.titleText || cachedData.journalText || paperId : paperId;
            // However, the original code used paperId for secondary sort, which is fine and more stable for text sorts.
            const detailRow = mainRow.nextElementSibling; // Get the associated detail row
            sortData[sortIndex] = { value: cellValue, mainRow, detailRow, paperId };
            sortIndex++;
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
            if (sortData[i].detailRow) {
                fragment.appendChild(sortData[i].detailRow);
            }
        }
        tbody.appendChild(fragment); // Single DOM append operation

        // --- Schedule UI Updates after DOM change ---
        requestAnimationFrame(() => {
            applyAlternatingShading();
            if (document.body.id !== 'html-export') {
                // Pass the currently visible rows after sorting to applyDuplicateShading
                const visibleRowsAfterSort = tbody.querySelectorAll('tr[data-paper-id]:not(.filter-hidden)');
                applyDuplicateShading(visibleRowsAfterSort); // Pass the NodeList
            }
            updateCounts();
        });
        currentClientSort = { column: sortBy, direction: newDirection };
        document.querySelectorAll('th .sort-indicator').forEach(ind => ind.textContent = '');
        const indicator = this.querySelector('.sort-indicator');
        if (indicator) {
            indicator.textContent = newDirection === 'ASC' ? '▲' : '▼';
        }
        // 3. Schedule removal of the busy cursor class AFTER a guaranteed delay
        setTimeout(() => {
            document.documentElement.classList.remove('busyCursor');
        }, 150); // Delay slightly longer than CSS delay
    }, 20); // Initial defer for adding busy cursor
}

document.addEventListener('DOMContentLoaded', function () {
    hideXrayCheckbox.addEventListener('change', applyLocalFilters);
    hideApprovedCheckbox.addEventListener('change', applyLocalFilters);
    onlySurveyCheckbox.addEventListener('click', cycleSurveyFilterState); // Use 'click' to handle cycling
    showPCBcheckbox.addEventListener('change', applyLocalFilters);
    showSolderCheckbox.addEventListener('change', applyLocalFilters);
    showPCBAcheckbox.addEventListener('change', applyLocalFilters);
    noFeaturesCheckbox.addEventListener('change', applyLocalFilters);
    showOtherCheckbox.addEventListener('change', applyLocalFilters);

    //server-side search disabled for now as FTS is broken. Using full-client-side search instead:
    searchInput.addEventListener('input', applyLocalFilters);

    document.getElementById('clear-search-btn').addEventListener('click', function() {
        searchInput.value = ''; // Clear the input value
        searchInput.dispatchEvent(new Event('input'));
    });

    headers.forEach(header => { header.addEventListener('click', sortTable);   });
    applyLocalFilters(); //apply initial filtering   
    updateSurveyCheckboxUI();
});


