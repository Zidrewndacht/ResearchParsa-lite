//globals.js
const batchModal = document.getElementById("batchModal");
const importModal = document.getElementById("importModal");
const exportModal = document.getElementById("exportModal");

//Hardocoded cells - used for multiple scripts:
const pdfCellIndex = 0;
const titleCellIndex = 1;
const yearCellIndex = 2;
const pageCountCellIndex = 3;
const journalCellIndex = 4;
const typeCellIndex = 5;
const relevanceCellIndex = 7;
const estScoreCellIndex = 36;

//HTML Elements:
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


// --- Batch Action Button Event Listeners ---
const parçaToolsBtn = document.getElementById('parça-tools-btn');
const classifyAllBtn = document.getElementById('classify-all-btn');
const classifyRemainingBtn = document.getElementById('classify-remaining-btn');
const verifyAllBtn = document.getElementById('verify-all-btn');
const verifyRemainingBtn = document.getElementById('verify-remaining-btn');
const batchStatusMessage = document.getElementById('batch-status-message');
const backupStatusMessage = document.getElementById('backup-status-message');

const importActionsBtn = document.getElementById('import-btn');
const exportActionsBtn = document.getElementById('export-btn');

const backupBtn = document.getElementById('backup-btn');
const restoreBtn = document.getElementById('restore-btn');

const headers = document.querySelectorAll('th[data-sort]');
let currentClientSort = { column: null, direction: 'ASC' };

let filterTimeoutId = null;
const FILTER_DEBOUNCE_DELAY = 200;

// Define the fields for which we want to count '✔️':
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

    'changed_by', 'verified', 'verified_by', 'user_comment_state' // user counting (Top-level)
];


// Pre-calculate symbol weights OUTSIDE the sort loop for efficiency
const SYMBOL_SORT_WEIGHTS = {
    '✔️': 2, // Yes
    '❌': 1, // No
    '❔': 0  // Unknown
};
const SYMBOL_PDF_WEIGHTS = {
    '📗': 3, // Annotated
    '📕': 2, // PDF
    '❔': 1,  // None
    '💰': 0 // Paywalled
};

// --- Status Cycling Logic ---
const STATUS_CYCLE = {
    '❔': { next: '✔️', value: 'true' },
    '✔️': { next: '❌', value: 'false' },
    '❌': { next: '❔', value: 'unknown' }
};
const VERIFIED_BY_CYCLE = {
    '👤': { next: '❔', value: 'unknown' }, 
    '❔': { next: '👤', value: 'user' },   
    // If user sees Computer (🖥️), next is User:
    // We assume the user wants to override/review it, not set it to computer.
    '🖥️': { next: '👤', value: 'user' } 
};

//show/hide modals:

function showBatchActions(){
    batchModal.offsetHeight;
    batchModal.classList.add('modal-active');
}
function closeBatchModal() { batchModal.classList.remove('modal-active'); }

function showImportActions(){
    importModal.offsetHeight;
    importModal.classList.add('modal-active');
}
function closeImportModal() { importModal.classList.remove('modal-active'); }

function showExportActions(){
    exportModal.offsetHeight;
    exportModal.classList.add('modal-active');   
    backupStatusMessage.innerHTML = 'Backups include the database, original and annotated PDFs, HTML export and a XLSX spreadsheet.<br><br>Restoring from a backup overwrites all existing data!';
    backupStatusMessage.style.color = '';

}
function closeExporthModal() { exportModal.classList.remove('modal-active'); }

function displayAbout(){
    modalSmall.offsetHeight;
    modalSmall.classList.add('modal-active');
}
function closeSmallModal() { modalSmall.classList.remove('modal-active'); }

//used by stats, comms and filtering:
function updateCounts() {   
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
                counts['pdf_present'] =   (counts['pdf_present']   || 0) + 1;       // Also count annotated as a PDF present
            } else if (pdfContent === '💰') { 
                counts['pdf_paywalled'] = (counts['pdf_paywalled'] || 0) + 1;
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
                countCell.title = `Stored PDFs: ${counts['pdf_present']}, Annotated PDFs: ${counts['pdf_annotated']}, Paywalleds: ${counts['pdf_paywalled']}. Data for the currently filtered set.`; // Set tooltip
            } else {
                // For all other fields, set the text content normally
                countCell.textContent = counts[field];
            }
        }
    });
}

