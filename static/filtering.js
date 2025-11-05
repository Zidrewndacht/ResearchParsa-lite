// static/filtering.js
/** This file contains client-side filtering code, shared between server-based full page and client-only HTML export.
 */

// Hardcoded cell indices based on the generic table structure
const pdfCellIndex = 0;
const titleCellIndex = 1;
const authorsCellIndex = 2; // Added authors cell index
const yearCellIndex = 3;
const pageCountCellIndex = 4;
const journalCellIndex = 5;
const typeCellIndex = 6;
const offtopicCellIndex = 7;
const relevanceCellIndex = 8;
const surveyCellIndex = 9;
const changedCellIndex = 10;
const changedByCellIndex = 11;
const verifiedCellIndex = 12;
const estScoreCellIndex = 13;
const verifiedByCellIndex = 14;
const commentedCellIndex = 15;
const detailsCellIndex = 16;

// Generic filter elements - adjust selectors as needed for your HTML
const searchInput = document.getElementById('search-input');
const hideOfftopicCheckbox = document.getElementById('hide-offtopic-checkbox');
const onlySurveyCheckbox = document.getElementById('only-survey-checkbox');

// Generic feature checkboxes - adjust or remove based on your table
// For now, removing the specific feature checkboxes as they are domain-specific
// const showPCBcheckbox = document.getElementById('show-pcb-checkbox');
// const showSolderCheckbox = document.getElementById('show-solder-checkbox');
// const showPCBAcheckbox = document.getElementById('show-pcba-checkbox');
// const noFeaturesCheckbox = document.getElementById('no-features-checkbox');
// const showOtherCheckbox = document.getElementById('show-other-checkbox');

let filterTimeoutId = null;
const FILTER_DEBOUNCE_DELAY = 250;
const MAX_STORED_OPEN_DETAILS = 10;
const headers = document.querySelectorAll('th[data-sort]');
let currentClientSort = { column: null, direction: 'ASC' };

// Pre-compiled regular expressions for search (if needed)
let searchRegex = null;
let searchTerms = [];

// Symbol weights for sorting status cells (✔️, ❌, ❔)
const SYMBOL_SORT_WEIGHTS = {
    '✔️': 2,
    '❌': 1,
    '❔': 0
};

// Symbol weights for PDF status cells (if applicable)
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

// --- Tri-State Survey Filter Logic (Generic version) ---
// Define the states for the survey filter
const SURVEY_FILTER_STATES = {
    ALL: 'all',           // Default: Show all items
    ONLY_SURVEYS: 'surveys', // Show only items marked as surveys (✔️)
    ONLY_NON_SURVEYS: 'non_surveys' // Show only items NOT marked as surveys (❌ or ❔)
};

// Store the current state of the survey filter
let currentSurveyFilterState = SURVEY_FILTER_STATES.ALL;

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
            checkbox.title = 'Currently showing all items. Click to show only Survey items';
            break;
        case SURVEY_FILTER_STATES.ONLY_SURVEYS:
            checkbox.checked = true; // Visually checked
            checkbox.indeterminate = false;
            checkbox.title = 'Currently showing only Surveys. Click to show only primary (non-survey) items';
            break;
        case SURVEY_FILTER_STATES.ONLY_NON_SURVEYS:
            checkbox.checked = false; // Visually unchecked
            checkbox.indeterminate = true; // Use indeterminate to show the third state
            checkbox.title = 'Currently showing only primary (non-survey) items. Click to show All items';
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

// Update getClientFilterState to include sort parameters
function getClientFilterState() {
    return {
        hide_offtopic: hideOfftopicCheckbox.checked ? 1 : 0,
        survey_filter: currentSurveyFilterState,
        search: searchInput.value.trim(),
        sort_by: currentClientSort.column || '',
        sort_dir: currentClientSort.direction || 'ASC'
    };
}

let urlUpdateTimeout;
function updateUrlWithClientFilters() {
    clearTimeout(urlUpdateTimeout);
    urlUpdateTimeout = setTimeout(() => {
        const url = new URL(window.location);
        const clientFilters = getClientFilterState();
        for (const [key, value] of Object.entries(clientFilters)) {
            // Always include everything: '1', '0', 'all', search string, etc.
            // This is important because some checkboxes are default on, other default off, etc.
            url.searchParams.set(key, String(value));
        }
        window.history.replaceState({}, '', url);
    }, 100);
}

let rafId = 0;
let currentFilterAbortController = null;
function applyLocalFilters() {
    // Cancel any ongoing filter operation
    if (currentFilterAbortController) {
        currentFilterAbortController.abort();
    }
    // Create a new abort controller for this operation
    currentFilterAbortController = new AbortController();
    const signal = currentFilterAbortController.signal;
    clearTimeout(filterTimeoutId);
    document.documentElement.classList.add('busyCursor');
    cancelAnimationFrame(rafId);
    filterTimeoutId = setTimeout(() => {
        // Check if operation was cancelled
        if (signal.aborted) return;
        // --- Pre-cache data for all rows to avoid repeated DOM queries ---
        const rows = tbody.querySelectorAll('tr[data-paper-id]');
        // Pre-calculate filter values outside the loop
        const hideOfftopicChecked = document.body.id === 'html-export' ? hideOfftopicCheckbox.checked : false;
        const minPageCountValue = document.body.id === 'html-export' ? (document.getElementById('min-page-count').value.trim() || 0) : 0;
        const yearFromValue = document.body.id === 'html-export' ? (document.getElementById('year-from').value.trim() || 0) : 0;
        const yearToValue = document.body.id === 'html-export' ? (document.getElementById('year-to').value.trim() || 0) : 0;
        const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
        const compiledSearchRegex = compileSearchRegex(searchTerm);

        // --- Cache data for all rows in a single pass ---
        for (let i = 0; i < rows.length; i++) {
            // Check if operation was cancelled during the loop
            if (signal.aborted) return;
            const row = rows[i];
            // Cache status cells
            const surveyCell = row.querySelector('.editable-status[data-field="is_survey"]');
            const offtopicCell = row.querySelector('.editable-status[data-field="is_offtopic"]');

            // Cache hidden data text
            let hiddenDataText = '';
            const hiddenDataCells = row.querySelectorAll('td.hidden-data-cell');
            for (let j = 0; j < hiddenDataCells.length; j++) {
                // Check if operation was cancelled during the loop
                if (signal.aborted) return;
                hiddenDataText += ' ' + (hiddenDataCells[j].textContent || '').toLowerCase();
            }
            // Cache main row text content (excluding hidden data cells) and the paper ID
            let visibleRowText = '';
            // Include the paper ID in the searchable text
            const paperId = row.getAttribute('data-paper-id'); // Get the paper ID
            if (paperId) {
                visibleRowText += ' ' + paperId.toLowerCase(); // Add it to the searchable text
            }
            for (let j = 0; j < row.cells.length; j++) {
                // Check if operation was cancelled during the loop
                if (signal.aborted) return;
                if (!row.cells[j].classList.contains('hidden-data-cell')) {
                    visibleRowText += ' ' + row.cells[j].textContent.toLowerCase();
                }
            }
            // Cache frequently accessed text values
            const journalText = row.cells[journalCellIndex]?.textContent?.trim().toLowerCase() || '';
            const titleText = row.cells[titleCellIndex]?.textContent?.trim().toLowerCase() || '';
            const authorsText = row.cells[authorsCellIndex]?.textContent?.trim().toLowerCase() || ''; // Cache authors text

            // Store all cached data in the WeakMap using the row element as the key
            rowCache.set(row, {
                surveyStatus: surveyCell ? surveyCell.textContent.trim() : '❔',
                offtopicStatus: offtopicCell ? offtopicCell.textContent.trim() : 'N/A',
                hiddenDataText,
                visibleRowText,
                journalText,
                titleText,
                authorsText, // Added authors text
                pageCount: row.cells[pageCountCellIndex]?.textContent?.trim() || '',
                year: row.cells[yearCellIndex]?.textContent?.trim() || ''
            });
        }
        /* ---------- 1.  shared batch containers ---------- */
        const toHide = [];
        const toShow = [];
        /* ---------- 2.  single walk over every <tr> using cached data ---------- */
        for (let i = 0; i < rows.length; i++) {
            // Check if operation was cancelled during the loop
            if (signal.aborted) return;
            const row = rows[i];
            // Get cached data from the WeakMap
            const cachedData = rowCache.get(row);
            let showRow = true;
            /* ----------------------------------------------------
                2a.  HTML-export-only filters
            ---------------------------------------------------- */
            if (document.body.id === 'html-export') {
                if (showRow && hideOfftopicChecked) {
                    if (cachedData.offtopicStatus === '✔️') {
                        showRow = false;
                    }
                }
                if (showRow && minPageCountValue > 0) {
                    const pageCount = parseInt(cachedData.pageCount, 10);
                    if (!isNaN(pageCount) && pageCount < minPageCountValue) {
                        showRow = false;
                    }
                }
                if (showRow && (yearFromValue || yearToValue)) {
                    const year = cachedData.year ? parseInt(cachedData.year, 10) : NaN;
                    if (isNaN(year) || (yearFromValue && year < yearFromValue) || (yearToValue && year > yearToValue)) {
                        showRow = false;
                    }
                }
            }
            /* ----------------------------------------------------
                2b.  universal filters (search, survey, …)
            ---------------------------------------------------- */
            // Search Term
            if (showRow && searchTerm) {
                // Fast string inclusion check first
                if (!cachedData.visibleRowText.includes(searchTerm) && !cachedData.hiddenDataText.includes(searchTerm)) {
                    showRow = false;
                }
                // If still showing, do more complex search if needed
                if (showRow && compiledSearchRegex) {
                    // Additional regex or multi-term checks if needed
                }
            }
            // Apply the tri-state survey filter logic
            if (showRow) {
                const surveyStatus = cachedData.surveyStatus;
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
            // Check if operation was cancelled during the loop
            if (signal.aborted) return;
            toHide[i].classList.add('filter-hidden');
        }
        for (let i = 0; i < toShow.length; i++) {
            // Check if operation was cancelled during the loop
            if (signal.aborted) return;
            toShow[i].classList.remove('filter-hidden');
        }
        rafId = requestAnimationFrame(() => {
            if (signal.aborted) return;
            if (document.body.id !== 'html-export') {
                const visibleRows = tbody.querySelectorAll('tr[data-paper-id]:not(.filter-hidden)');
                applyDuplicateShading(visibleRows);
                const applyButton = document.getElementById('apply-serverside-filters');
                applyButton.style.opacity = '0';
                applyButton.style.pointerEvents = 'none';
            }
            // Apply the current sort after filtering
            if (currentClientSort.column) {
                performSort(currentClientSort.column, currentClientSort.direction);
            }
            updateUrlWithClientFilters();
            applyAlternatingShading();
            updateCounts();
            restoreDetailState(); // Call the new function to open rows based on the set and current DOM state
            document.documentElement.classList.remove('busyCursor');
            // Clean up the abort controller when operation completes successfully
            if (currentFilterAbortController?.signal === signal) {
                currentFilterAbortController = null;
            }
        });
    }, FILTER_DEBOUNCE_DELAY);
}

// Pre-calculate sort column indices for faster lookups based on generic table
const SORT_COLUMN_INDICES = {
    'pdf-link': pdfCellIndex, // Assuming this maps to the PDF cell
    'title': titleCellIndex,
    'authors': authorsCellIndex, // Added authors column index mapping
    'year': yearCellIndex,
    'page_count': pageCountCellIndex,
    'journal': journalCellIndex,
    'type': typeCellIndex, // Assuming this maps to the type cell
    'is_offtopic': offtopicCellIndex,
    'relevance': relevanceCellIndex,
    'is_survey': surveyCellIndex,
    'changed': changedCellIndex,
    'changed_by': changedByCellIndex,
    'verified': verifiedCellIndex,
    'estimated_score': estScoreCellIndex,
    'verified_by': verifiedByCellIndex,
    'user_comment_state': commentedCellIndex
};

// Define fields that do NOT use the .editable-status selector for sorting
// These will be sorted using their direct cell text content, but still potentially using SYMBOL_SORT_WEIGHTS if they contain symbols.
const NON_EDITABLE_STATUS_FIELDS = new Set([
    'user_comment_state', // Commented
    'type',                // Type
    'authors',             // Authors - Added as it's a text field, not an editable status
    'relevance',           // Relevance
    'estimated_score'      // Estimated Score
    // Add other non-editable status fields here if any are discovered later
    // e.g., 'some_other_field_name'
]);

function performSort(sortBy, direction, visibleRows = null) {
    if (!sortBy) return;
    // Use provided visible rows or get them from DOM
    const rowsToSort = visibleRows || tbody.querySelectorAll('tr[data-paper-id]:not(.filter-hidden)');
    if (rowsToSort.length === 0) return;
    // Calculate the header index based on the sort column
    const sortHeader = document.querySelector(`th[data-sort="${sortBy}"]`);
    if (!sortHeader) return;
    const headerIndex = Array.prototype.indexOf.call(sortHeader.parentNode.children, sortHeader);
    const sortData = new Array(rowsToSort.length);
    // Pre-calculate sort type to avoid repeated checks inside the loop
    // Assuming the header text or data-sort attribute for the date column is 'changed' based on the cell class 'changed-cell'
    const isDateSort = sortBy === 'changed'; // Adjust 'changed' if your data-sort attribute is different
    const isNumericSort = ['year', 'estimated_score', 'page_count', 'relevance'].includes(sortBy);
    const isPDFSort = sortBy === 'pdf-link';
    const isEditableStatusSort = !isNumericSort && !isPDFSort && !NON_EDITABLE_STATUS_FIELDS.has(sortBy) && !['title', 'journal', 'authors', 'changed_by', 'changed', 'verified_by'].includes(sortBy); // Excluded 'authors' from editable status check
    for (let i = 0; i < rowsToSort.length; i++) {
        const mainRow = rowsToSort[i];
        const paperId = mainRow.getAttribute('data-paper-id');
        let cellValue;
        if (isDateSort) {
            const cell = mainRow.cells[headerIndex];
            const cellText = cell ? cell.textContent.trim() : '';
            // Parse the date string DD/MM/YY HH:MM:SS
            // Note: This assumes the date is always in this format. Adjust regex if format can vary.
            const dateMatch = cellText.match(/(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
            if (dateMatch) {
                const [, day, month, year, hour, minute, second] = dateMatch;
                // Create a Date object, assuming 20xx for the year (e.g., '25' -> 2025)
                // Date constructor uses 0-indexed months (0-11), so subtract 1 from month
                cellValue = new Date(2000 + parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), parseInt(second));
            } else {
                // If the date string doesn't match the expected format, treat as invalid date (sorts last)
                console.warn(`Invalid date format for sorting: ${cellText}`);
                cellValue = new Date(NaN); // Invalid Date object
            }
        } else if (isNumericSort) {
            const cell = mainRow.cells[headerIndex];
            cellValue = cell ? parseFloat(cell.textContent.trim()) || 0 : 0;
        } else if (isPDFSort) {
            const cell = mainRow.cells[headerIndex];
            cellValue = SYMBOL_PDF_WEIGHTS[cell?.textContent.trim()] ?? 0;
        } else if (isEditableStatusSort) {
            const cell = mainRow.querySelector(`.editable-status[data-field="${sortBy}"]`);
            cellValue = SYMBOL_SORT_WEIGHTS[cell?.textContent.trim()] ?? 0;
        } else {
            const cell = mainRow.cells[headerIndex];
            const cellText = cell ? cell.textContent.trim() : '';
            if (NON_EDITABLE_STATUS_FIELDS.has(sortBy)) {
                // For 'authors', 'type', 'relevance', 'estimated_score', etc., use direct text content
                // If they contain symbols, SYMBOL_SORT_WEIGHTS will be used below
                if (sortBy === 'authors' || sortBy === 'type' || sortBy === 'relevance' || sortBy === 'estimated_score') {
                     cellValue = cellText; // Treat as string for these specific fields
                } else {
                     // For other non-editable status fields, check symbol weights
                     cellValue = SYMBOL_SORT_WEIGHTS[cellText] ?? 0;
                }
            } else {
                cellValue = cellText;
            }
        }
        const detailRow = mainRow.nextElementSibling;
        sortData[i] = { value: cellValue, mainRow, detailRow, paperId };
    }
    // Sort the data array
    sortData.sort((a, b) => {
        let comparison = 0;
        const aValue = a.value;
        const bValue = b.value;
        if (aValue instanceof Date && bValue instanceof Date) {
            // Compare dates
            if (isNaN(aValue)) { // Check if aValue is an invalid date
                 if (isNaN(bValue)) { // Both invalid, keep original order
                     comparison = 0;
                 } else { // aValue invalid, bValue valid -> aValue comes last
                     comparison = 1;
                 }
            } else if (isNaN(bValue)) { // aValue valid, bValue invalid -> bValue comes last
                 comparison = -1;
            } else { // Both valid dates
                comparison = aValue - bValue; // Subtraction works for valid dates
            }
        } else if (typeof aValue === 'string' && typeof bValue === 'string') {
            comparison = aValue.localeCompare(bValue, undefined, { sensitivity: 'base' });
        } else {
            // Handle comparisons between different types if necessary, defaulting to value comparison
            if (aValue > bValue) comparison = 1;
            else if (aValue < bValue) comparison = -1;
        }
        if (comparison === 0) {
            // Secondary sort by paperId to ensure stability
            if (a.paperId > b.paperId) comparison = 1;
            else if (a.paperId < b.paperId) comparison = -1;
        }
        return direction === 'DESC' ? -comparison : comparison;
    });
    // Batch update the DOM
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < sortData.length; i++) {
        fragment.appendChild(sortData[i].mainRow);
        if (sortData[i].detailRow) {
            fragment.appendChild(sortData[i].detailRow);
        }
    }
    tbody.appendChild(fragment); // Single DOM append operation
    // Update the sort indicator
    document.querySelectorAll('th .sort-indicator').forEach(ind => ind.textContent = '');
    const indicator = sortHeader.querySelector('.sort-indicator');
    if (indicator) {
        indicator.textContent = direction === 'ASC' ? '▲' : '▼';
    }
}

function sortTable() {
    //console.log("sortTable called for column:", this.getAttribute('data-sort'));
    document.documentElement.classList.add('busyCursor');
    setTimeout(() => {
        const sortBy = this.getAttribute('data-sort');
        if (!sortBy) return;
        let newDirection = 'DESC';
        if (currentClientSort.column === sortBy) {
            newDirection = currentClientSort.direction === 'DESC' ? 'ASC' : 'DESC';
        }
        currentClientSort = { column: sortBy, direction: newDirection };
        // Perform the sort immediately on current visible rows
        performSort(sortBy, currentClientSort.direction);
        // Then apply the same UI updates that happen in the filtering flow
        requestAnimationFrame(() => {
            if (document.body.id !== 'html-export') {
                const visibleRows = tbody.querySelectorAll('tr[data-paper-id]:not(.filter-hidden)');
                applyDuplicateShading(visibleRows);
            }
            updateUrlWithClientFilters();
            applyAlternatingShading();
            document.documentElement.classList.remove('busyCursor');
        });
    }, 50);
}

// --- Add F3 Shortcut ---
document.addEventListener('keydown', function(event) {
    if (event.key === 'F3') {
        event.preventDefault();
        searchInput.focus();
    }
});

function initializeClientFilters() {
    const urlParams = new URLSearchParams(window.location.search);
    // For each checkbox, if there's a URL parameter, use it to set the state
    // Otherwise, keep the existing DOM state
    const checkboxParams = {
        'hide_offtopic': hideOfftopicCheckbox,
        // Removed feature-specific checkboxes
    };
    for (const [param, checkbox] of Object.entries(checkboxParams)) {
        const paramValue = urlParams.get(param);
        if (paramValue !== null) {
            checkbox.checked = paramValue === '1';
        }
    }
    // Handle search input
    const searchValueFromUrl = urlParams.get('search');
    if (searchValueFromUrl !== null) {
        searchInput.value = searchValueFromUrl;
    }
    // Handle open detail IDs from URL
    const openDetailsParam = urlParams.get('open_details');
    if (openDetailsParam) {
        const initialOpenIds = openDetailsParam.split(',').map(id => id.trim()).filter(id => id !== '');
        // Limit and populate the set
        openDetailIds = new Set(initialOpenIds.slice(0, MAX_STORED_OPEN_DETAILS));
        //console.log("Initialized openDetailIds from URL:", [...openDetailIds]); // Debug log
    } else {
        // Ensure the set is initialized as empty if no param
        openDetailIds = new Set();
    }
    // Handle survey filter state
    const surveyFilterValue = urlParams.get('survey_filter');
    if (surveyFilterValue) {
        currentSurveyFilterState = surveyFilterValue;
    }
    // Handle sort parameters - only set if they exist in URL
    const sortColumnFromUrl = urlParams.get('sort_by');
    const sortDirectionFromUrl = urlParams.get('sort_dir');
    if (sortColumnFromUrl) {
        currentClientSort = {
            column: sortColumnFromUrl,
            direction: sortDirectionFromUrl === 'DESC' ? 'DESC' : 'ASC'
        };
        // Update the sort indicator in the UI
        const sortHeader = document.querySelector(`th[data-sort="${currentClientSort.column}"]`);
        if (sortHeader) {
            const indicator = sortHeader.querySelector('.sort-indicator');
            if (indicator) {
                indicator.textContent = currentClientSort.direction === 'ASC' ? '▲' : '▼';
            }
        }
    } else {
        // If no sort parameters in URL, reset to null state (no sort applied)
        currentClientSort = { column: null, direction: 'ASC' };
    }
    updateSurveyCheckboxUI();
    // Update URL to reflect initial state (this ensures the URL is clean and consistent)
    updateUrlWithClientFilters();
}

let openDetailIds = new Set();
let detailStateUpdateTimeout = null;
function updateUrlWithDetailState() {
    clearTimeout(detailStateUpdateTimeout);
    detailStateUpdateTimeout = setTimeout(() => {
        const url = new URL(window.location);
        // Convert set to sorted array to ensure consistent order (optional but good practice)
        const sortedIds = [...openDetailIds].sort((a, b) => a - b).slice(0, MAX_STORED_OPEN_DETAILS);
        if (sortedIds.length > 0) {
             url.searchParams.set('open_details', sortedIds.join(','));
        } else {
             // Remove the parameter if no details are open
             url.searchParams.delete('open_details');
        }
        // Use replaceState to avoid adding history entries
        window.history.replaceState({}, '', url);
         //console.log("URL updated with open detail IDs:", sortedIds); // Debug log
    }, 100); // Debounce delay
}

function restoreDetailState() {
    //console.log("Starting restoreDetailState. Intended open IDs:", [...openDetailIds]); // Debug log
    // --- Phase 1: Open detail rows that are intended to be open and whose main row is visible ---
    const idsToOpen = [...openDetailIds]; // Get a copy of the current set of intended open IDs
    idsToOpen.forEach(paperId => {
        // Find the main row in the CURRENTLY visible DOM
        const mainRow = document.querySelector(`tr[data-paper-id="${paperId}"]:not(.filter-hidden)`);
        if (mainRow) {
            // Main row exists and is visible after filtering
            const toggleButton = mainRow.querySelector('.toggle-btn');
            if (toggleButton) {
                // Check if the detail row is already expanded
                const detailRow = mainRow.nextElementSibling;
                const isCurrentlyExpanded = detailRow && detailRow.classList.contains('expanded');
                // Only call toggleDetails if it's not already expanded
                if (!isCurrentlyExpanded) {
                    //console.log(`Restoring (opening) detail row for paper ID ${paperId}`); // Debug log
                    // Call the toggleDetails function (from comms.js or ghpages.js)
                    // This handles the logic for showing/hiding and fetching content if needed
                    toggleDetails(toggleButton);
                    // The toggleDetails function should manage the openDetailIds Set and URL correctly.
                } else {
                    //console.log(`Detail row for paper ID ${paperId} is already expanded as intended.`); // Debug log
                }
            } else {
                console.warn(`Toggle button not found for paper ID ${paperId} during restore.`); // Debug log
            }
        } else {
            // Main row doesn't exist or is hidden by current filters.
            // The ID remains in the set for potential future restoration.
            // This handles the case where a filter hides a paper that was previously open.
            //console.log(`Main row for paper ID ${paperId} not found or hidden, keeping ID for later.`); // Debug log
        }
    });
    // --- REFINED Phase 2 in restoreDetailState ---
    // Iterate through ALL *currently visible and expanded* detail rows
    const allExpandedVisibleDetailRows = document.querySelectorAll('tr.detail-row.expanded:not(.filter-hidden)');
    allExpandedVisibleDetailRows.forEach(detailRow => {
        const mainRow = detailRow.previousElementSibling;
        if (mainRow && mainRow.matches('tr[data-paper-id]')) { // Ensure it's a main row
            const paperId = mainRow.getAttribute('data-paper-id');
            // Check if the main row's ID is NOT in the intended open set
            if (!openDetailIds.has(paperId)) {
                // The detail row is expanded, but its ID is not in the intended open set.
                // We need to close it. Find its toggle button and call toggleDetails.
                const toggleButton = mainRow.querySelector('.toggle-btn');
                if (toggleButton) {
                    //console.log(`Closing unintended detail row for paper ID ${paperId}`); // Debug log
                    // Call toggleDetails to close it. This should correctly update the set and URL.
                    toggleDetails(toggleButton);
                } else {
                    console.warn(`Toggle button not found for paper ID ${paperId} when trying to close unintended detail row.`); // Debug log
                }
            }
        }
    });
    //console.log("Finished restoreDetailState. Final open IDs:", [...openDetailIds]); // Debug log
}

/**
 * Copies the provided paper ID to the clipboard.
 * Provides user feedback by changing the button text to 'Copied!' temporarily.
 * @param {string} paperId - The ID of the paper to copy.
 * @param {HTMLElement} buttonElement - The button that was clicked.
 */
function copyPaperId(paperId, buttonElement) {
    if (paperId) {
        // Store original text
        const originalText = buttonElement.textContent;
        // Change button text immediately to provide feedback
        buttonElement.textContent = 'Copied!';
        navigator.clipboard.writeText(paperId)
            .then(() => {
                //console.log('Paper ID copied to clipboard:', paperId);
                // The text is already 'Copied!', now reset it after a delay
                setTimeout(() => {
                    buttonElement.textContent = originalText;
                }, 2000); // Reset text after 2 seconds
            })
            .catch(err => {
                console.error('Failed to copy ID: ', err);
                alert('Failed to copy ID to clipboard.');
                // Reset text if copy failed
                buttonElement.textContent = originalText;
            });
    } else {
        console.warn('Paper ID is empty or undefined.');
        alert('Paper ID is empty and cannot be copied.');
    }
}

/**
 * Copies the provided BibTeX string to the clipboard.
 * Provides user feedback by changing the button text to 'Copied!' temporarily.
 * @param {string} bibtexString - The BibTeX citation string to copy.
 * @param {HTMLElement} buttonElement - The button that was clicked.
 */
function copyBibtex(bibtexString, buttonElement) {
    if (bibtexString) {
        // Store original text
        const originalText = buttonElement.textContent;
        // Change button text immediately to provide feedback
        buttonElement.textContent = 'Copied!';
        navigator.clipboard.writeText(bibtexString)
            .then(() => {
                //console.log('BibTeX copied to clipboard.');
                // The text is already 'Copied!', now reset it after a delay
                setTimeout(() => {
                    buttonElement.textContent = originalText;
                }, 2000); // Reset text after 2 seconds
            })
            .catch(err => {
                console.error('Failed to copy BibTeX: ', err);
                alert('Failed to copy BibTeX to clipboard.');
                 // Reset text if copy failed
                 buttonElement.textContent = originalText;
            });
    } else {
        console.warn('BibTeX content is empty.');
        alert('BibTeX content is empty and cannot be copied.');
    }
}

// Existing DOMContentLoaded listener and other code follows...
document.addEventListener('DOMContentLoaded', function () {
    // Apply client filters from URL first
    initializeClientFilters();
    // Generic checkbox listeners
    hideOfftopicCheckbox.addEventListener('change', applyLocalFilters);
    onlySurveyCheckbox.addEventListener('click', cycleSurveyFilterState);

    // Removed listeners for domain-specific checkboxes
    // showPCBcheckbox.addEventListener('change', applyLocalFilters);
    // showSolderCheckbox.addEventListener('change', applyLocalFilters);
    // showPCBAcheckbox.addEventListener('change', applyLocalFilters);
    // noFeaturesCheckbox.addEventListener('change', applyLocalFilters);
    // showOtherCheckbox.addEventListener('change', applyLocalFilters);

    searchInput.addEventListener('input', () => {
        // For search specifically, we might want a shorter debounce time
        clearTimeout(filterTimeoutId);
        document.documentElement.classList.add('busyCursor');
        // Cancel any ongoing filter operation
        if (currentFilterAbortController) {
            currentFilterAbortController.abort();
        }
        // Create a new abort controller for this operation
        currentFilterAbortController = new AbortController();
        const signal = currentFilterAbortController.signal;
        filterTimeoutId = setTimeout(() => {
            if (signal.aborted) return;
            applyLocalFilters();
        }, 150); // Shorter debounce for search
    });
    document.getElementById('clear-search-btn').addEventListener('click', function() {
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input'));
    });
    headers.forEach(header => {
        header.addEventListener('click', sortTable);
    });
    applyLocalFilters(); // Apply initial filtering
    updateSurveyCheckboxUI();
});