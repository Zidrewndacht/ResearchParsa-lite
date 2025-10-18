// static/stats.js
/** This file contains client-side statistics code, shared between server-based full page and client-only HTML export.
 * Also includes all modal open/close logic for now. 
 */

// stats.js
/** Stats-related Functionality **/
let latestCounts = {}; // This will store the counts calculated by updateCounts
let latestYearlyData = {}; 

let isStacked = false; // Default state
let isCumulative = false; // Default state
let showPieCharts = false; // Default to bar charts
let showKeywordCloud = false; 

const statsBtn = document.getElementById('stats-btn');
const aboutBtn = document.getElementById('about-btn');
const modal = document.getElementById('statsModal');
const modalSmall = document.getElementById('aboutModal');
const spanClose = document.querySelector('#statsModal .close'); // Specific close button
const smallClose = document.querySelector('#aboutModal .close'); // Specific close button

// --- Define Consistent Colors for Techniques ---
// Define the fixed color order used in the Techniques Distribution chart (sorted)
const techniquesColors = [
    'hsla(347, 60%, 69%, 0.95)', // Red - Classic CV
    'hsla(204, 62%, 57%, 0.95)',  // Blue - Traditional ML
    'hsla(52, 80%, 47%, 0.95)',  // Yellow - CNN Classifier
    'hsla(180, 32%, 52%, 0.95)',  // Teal - CNN Detector
    'hsla(260, 60%, 66%, 0.95)', // Purple - R-CNN Detector
    'hsla(25, 70%, 63%, 0.95)',  // Orange - Transformer
    'hsla(0, 0%, 68%, 0.95)',   // Grey - Other DL
    'hsla(96, 66%, 49%, 0.95)', // Green - Hybrid
];
const techniquesBorderColors = [
    'hsla(347, 70%, 39%, 0.75)',
    'hsla(204, 82%, 28%, 0.75)',
    'hsla(42, 100%, 28%, 0.75)',
    'hsla(180, 48%, 28%, 0.75)',
    'hsla(260, 100%, 40%, 0.75)',
    'hsla(30, 100%, 33%, 0.75)',
    'hsla(0, 0%, 38%, 0.75)',
    'hsla(147, 48%, 38%, 0.75)',
];

// Map technique fields to their *original* color index in the unsorted list
// IMPORTANT: This list must match the order of TECHNIQUE_FIELDS_FOR_YEARLY
const TECHNIQUE_FIELDS_FOR_YEARLY = [
    'technique_classic_cv_based', 'technique_ml_traditional',
    'technique_dl_cnn_classifier', 'technique_dl_cnn_detector', 'technique_dl_rcnn_detector',
    'technique_dl_transformer', 'technique_dl_other', 'technique_hybrid'
];
const TECHNIQUE_FIELD_COLOR_MAP = {};

// Include Datasets here temporarily to get the label mapping easily,
// then filter it out for data/labels for the Techniques chart
const TECHNIQUE_FIELDS_ALL = [
    'technique_classic_cv_based', 'technique_ml_traditional',
    'technique_dl_cnn_classifier', 'technique_dl_cnn_detector', 'technique_dl_rcnn_detector',
    'technique_dl_transformer', 'technique_dl_other', 'technique_hybrid',
    'technique_available_dataset' // Included to get label easily
];

// --- Define Consistent Colors for Features ---
// These are the original colors used in the Features Distribution chart (in original order)
// Note: There are 12 features but only 5 distinct colors used.
const featuresColorsOriginalOrder = [
    'hsla(130, 27%, 60%, 0.95)',    //  - PCB - Tracks (Teal)
    'hsla(130, 27%, 60%, 0.95)',    //  - PCB - Holes (Teal)
    'hsla(130, 27%, 60%, 0.95)',    //  - PCB - other (Teal)
    'hsla(0, 0%, 68%, 0.95)',       //  - solder - Insufficient (Grey)
    'hsla(0, 0%, 68%, 0.95)',       //  - solder - Excess (Grey)
    'hsla(0, 0%, 68%, 0.95)',       //  - solder - Void (Grey)
    'hsla(0, 0%, 68%, 0.95)',       //  - solder - Crack (Grey)
    'hsla(0, 0%, 68%, 0.95)',       //  - solder - other (Grey)
    'hsla(347, 70%, 72%, 0.95)',    //  - PCBA - Orientation (Red)
    'hsla(347, 70%, 72%, 0.95)',    //  - PCBA - Missing Comp (Red)
    'hsla(347, 70%, 72%, 0.95)',    //  - PCBA - Wrong Comp (Red)
    'hsla(347, 70%, 72%, 0.95)',    //  - PCBA - Other (Red)
    'hsla(204, 88%, 70%, 0.95)',    //  - Cosmetic (Blue)
    'hsla(284, 88%, 70%, 0.95)',    //  - Other 
];
const featuresBorderColorsOriginalOrder = [
    'hsla(144, 83%, 28%, 0.75)',    // 0 - PCB - Tracks
    'hsla(144, 82%, 28%, 0.75)',    // 1 - PCB - Holes
    'hsla(144, 82%, 28%, 0.75)',    // 
    'hsla(0, 0%, 38%, 0.75)',       // 2 - solder - Insufficient
    'hsla(0, 0%, 38%, 0.75)',       // 3 - solder - Excess
    'hsla(0, 0%, 38%, 0.75)',       // 4 - solder - Void
    'hsla(0, 0%, 38%, 0.75)',       // 5 - solder - Crack
    'hsla(0, 0%, 38%, 0.75)',       // 
    'hsla(347, 70%, 39%, 0.75)',    // 6 - PCBA - Orientation
    'hsla(347, 70%, 39%, 0.75)',    // 7 - PCBA - Missing Comp
    'hsla(347, 70%, 39%, 0.75)',    // 8 - PCBA - Wrong Comp
    'hsla(347, 70%, 39%, 0.75)',    // 
    'hsla(219, 100%, 40%, 0.75)',   // 9 - Cosmetic
    'hsla(284, 82%, 47%, 0.75)',    // 10 - Other 
];

// Map feature fields to their *original* index in the unsorted list
// IMPORTANT: This list must match the order of FEATURE_FIELDS_FOR_YEARLY
const FEATURE_FIELDS_FOR_YEARLY = [
    'features_tracks', 'features_holes', 'features_bare_pcb_other', 
    'features_solder_insufficient', 'features_solder_excess', 'features_solder_void', 'features_solder_crack',  'features_solder_other',
    'features_orientation', 'features_wrong_component', 'features_missing_component', 'features_component_other', 
    'features_cosmetic', 
    'features_other_state'
];
const FEATURE_FIELD_INDEX_MAP = {};
const FEATURE_FIELDS = [
    'features_tracks', 'features_holes', 'features_bare_pcb_other', 
    'features_solder_insufficient', 'features_solder_excess', 'features_solder_void', 'features_solder_crack',  'features_solder_other',
    'features_orientation', 'features_wrong_component', 'features_missing_component', 'features_component_other', 
    'features_cosmetic', 
    'features_other_state'
];

// --- Map Feature Fields to their Color Groups for Line Chart ---
// Define the distinct color groups for the line chart based on original colors
// The keys are the indices in the original color arrays that represent unique colors
const featureColorGroups = {
    0: { label: 'Bare PCB Defects', fields: [] },      
    3: { label: 'Solder Defects', fields: [] },    
    8: { label: 'PCB Assembly Defects', fields: [] },       
    12: { label: 'Cosmetic', fields: [] },          
    13: { label: 'Other', fields: [] }
};

// Map field names (data-field values / structure keys) to user-friendly labels (based on your table headers)
const FIELD_LABELS = {
    // Features
    'features_tracks': 'Tracks',
    'features_holes': 'Holes',
    'features_bare_pcb_other': 'Other (bare) PCB',
    'features_solder_insufficient': 'Insufficient Solder',
    'features_solder_excess': 'Excess Solder',
    'features_solder_void': 'Solder Voids',
    'features_solder_crack': 'Solder Cracks',
    'features_solder_other': 'Solder (Other)',
    'features_orientation': 'Orientation/Polarity', // Combined as per previous logic
    'features_wrong_component': 'Wrong Component',
    'features_missing_component': 'Missing Component',
    'features_component_other': 'Component (Other)',
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

// --- Define Mapping for Publication Types ---
const PUB_TYPE_MAP = {
    'article': 'Journal',
    'inproceedings': 'Conference',
    'proceedings': 'Conference', // Example: map proceedings to Conference as well
    'conference': 'Conference',    // Example: map conference to Conference as well
    // Add other BibTeX types if needed, e.g.:
    'techreport': 'Report',
    'book': 'Book',
    'booklet': 'Booklet',
    'manual': 'Manual',
    'mastersthesis': 'Thesis (Masters)',
    'phdthesis': 'Thesis (PhD)',
    'unpublished': 'Unpublished'
};
function mapPubType(type) {
    return PUB_TYPE_MAP[type] || type; // Return mapped value or original if not found
}

// Define the fields for which we want to count '✔️':
const COUNT_FIELDS = [
    'pdf_present', 
    'pdf_annotated',

    'is_offtopic', 'is_survey', 'is_through_hole', 'is_smt', 'is_x_ray', // Classification (Top-level)

    'features_tracks', 'features_holes', 'features_bare_pcb_other',
    'features_solder_insufficient', 'features_solder_excess',
    'features_solder_void', 'features_solder_crack',  'features_solder_other',
    'features_orientation', 'features_wrong_component', 'features_missing_component',  'features_component_other',
    'features_cosmetic', 'features_other_state',

    'technique_classic_cv_based', 'technique_ml_traditional',
    'technique_dl_cnn_classifier', 'technique_dl_cnn_detector', 'technique_dl_rcnn_detector',
    'technique_dl_transformer', 'technique_dl_other', 'technique_hybrid', 'technique_available_dataset', // Techniques (Nested under 'technique')

    'changed_by', 'verified', 'verified_by', 'user_comment_state' // user counting (Top-level)
];

// Helper used by stats, comms and filtering:
function updateCounts() {
    const counts = {};
    const yearlySurveyImpl = {}; // { year: { surveys: count, impl: count } }
    const yearlyTechniques = {}; // { year: { technique_field: count, ... } }
    const yearlyFeatures =   {}; // { year: { feature_field: count, ... } }
    const yearlyPubTypes = {}; // { year: { pubtype1: count, pubtype2: count, ... } }
    const yearlyModels = {}; // { year: { modelName: count, ... } }

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

        COUNT_FIELDS.forEach(field => {
            // Skip the PDF fields as they are handled separately above
            if (field === 'pdf_present' || field === 'pdf_annotated') {
                 return; // Skip to the next field
            }

            const cell = row.querySelector(`[data-field="${field}"]`);
            const cellText = cell ? cell.textContent.trim() : '';
            if (field === 'model') {
                if (cellText && cellText !== '') { // Check if there's content
                    // Split the content by comma and trim whitespace
                    const modelNames = cellText.split(',').map(name => name.trim()).filter(name => name !== '');
                    // Add the number of distinct models found in this cell to the total count
                    counts[field] += modelNames.length;

                    // --- Update Yearly Model Counts ---
                    const yearCell = row.cells[yearCellIndex];
                    const yearText = yearCell ? yearCell.textContent.trim() : '';
                    const year = yearText ? parseInt(yearText, 10) : null;
                    if (year && !isNaN(year)) {
                        if (!yearlyModels[year]) {
                            yearlyModels[year] = {};
                        }
                        modelNames.forEach(modelName => {
                            // Increment count for this specific model name in this specific year
                            yearlyModels[year][modelName] = (yearlyModels[year][modelName] || 0) + 1;
                        });
                    }
                }
                // After processing the model field, return to avoid the default '✔️' check below
                return;
            }

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
            // Update Publication Type counts ---
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
            // Note: Yearly model counts are updated inside the 'model' field loop above
        }
    });

    // Make counts available outside this function
    latestCounts = counts;
    latestYearlyData = {
        surveyImpl: yearlySurveyImpl,
        techniques: yearlyTechniques,
        features: yearlyFeatures,
        pubTypes: yearlyPubTypes,
        models: yearlyModels
    };

    // ... (rest of the function remains the same: visible/loaded counts, footer updates)
    if (document.body.id === 'html-export') {
        // Alternative code for specific page
        document.getElementById('visible-count-cell').innerHTML = `<strong>${visiblePaperCount}</strong> paper${visiblePaperCount !== 1 ? 's' : ''} of <strong>${totalPaperCount}</strong>`;
    } else {
        // Original code for other pages
        const visiblePapersCountCell = document.getElementById('visible-papers-count');
        const loadedPapersCountCell = document.getElementById('loaded-papers-count');
        loadedPapersCountCell.textContent = loadedPaperCount;
        visiblePapersCountCell.textContent = visiblePaperCount;
    }

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
                countCell.title = `Stored PDFs: ${counts['pdf_present']}, Annotated PDFs: ${counts['pdf_annotated']}, Paywalled: ${counts['pdf_paywalled']}. Data for the currently filtered set.`; // Set tooltip
            } else {
                // For all other fields, set the text content normally
                // Now, counts['model'] reflects the total number of model mentions
                countCell.textContent = counts[field];
            }
        }
    });
}

function calculateJournalConferenceStats() {
    const journalCounts = {};
    const conferenceCounts = {};
    // Select only VISIBLE main rows
    const visibleRows = document.querySelectorAll('#papersTable tbody tr[data-paper-id]:not(.filter-hidden)');
    visibleRows.forEach(row => {
        const journalCell = row.cells[journalCellIndex]; // Use the global defined in globals.js
        const typeCell = row.cells[typeCellIndex]; // Use the global defined in globals.js
        if (journalCell && typeCell) {
            const journalName = journalCell.textContent.trim();
            const type = typeCell.getAttribute('title') || typeCell.textContent.trim(); // Prefer title attribute for type
            // Only count if journal name is not empty
            if (journalName) {
                if (type && type.toLowerCase() === 'article') {
                    journalCounts[journalName] = (journalCounts[journalName] || 0) + 1;
                } else if (type && type.toLowerCase() === 'inproceedings') {
                    conferenceCounts[journalName] = (conferenceCounts[journalName] || 0) + 1; // Use journal cell content for conf name
                }
            }
        }
    });
    // Sort and filter results (count >= 2)
    const sortedJournals = Object.entries(journalCounts)
        .filter(([name, count]) => count >= 1) // Filter after counting
        .sort((a, b) => b[1] - a[1]); // Sort by count descending
    const sortedConferences = Object.entries(conferenceCounts)
        .filter(([name, count]) => count >= 1) // Filter after counting
        .sort((a, b) => b[1] - a[1]); // Sort by count descending
    return {
        journals: sortedJournals.map(([name, count]) => ({ name, count })),
        conferences: sortedConferences.map(([name, count]) => ({ name, count }))
    };
}

function calculateCumulativeData(originalDataArray) {
    if (!originalDataArray || originalDataArray.length === 0) return [];
    const cumulativeData = [];
    let sum = 0;
    for (let i = 0; i < originalDataArray.length; i++) {
        sum += originalDataArray[i];
        cumulativeData.push(sum);
    }
    return cumulativeData;
}
/* ----------  AUTO-ORDER DATASETS WHEN STACKED  ---------- */
function reorderDatasetsForStacking() {
    if (!isStacked) return;                // nothing to do when un-stacked
    const charts = [
        window.surveyVsImplLineChartInstance,
        window.techniquesPerYearLineChartInstance,
        window.featuresPerYearLineChartInstance,
        window.pubTypesPerYearLineChartInstance
    ].filter(Boolean);

    charts.forEach(chart => {
        const { datasets } = chart.data;

        /* Build an array of { datasetIndex, total } using the CURRENT data
           (already cumulative if cumulative is on) */
        const totals = datasets.map((ds, idx) => ({
            idx,
            total: ds.data.reduce((a, b) => a + b, 0)
        }));

        // totals.sort((A, B) => B.total - A.total);        /* Sort descending by total */
        totals.sort((A, B) => A.total - B.total);            /* Sort ascending by total (smallest first) to put smallest on bottom when stacked */
        /* Re-order only the datasets array (colours/labels stay intact) */
        chart.data.datasets = totals.map(t => datasets[t.idx]);
        chart.update();
    });
}

/* ----------  cumulative total in legend: Kimi K2 ---------- */
function cumulativeLegendLabels(chart) {
  const   defaults = Chart.defaults.plugins.legend.labels.generateLabels;
  const   labels   = defaults.call(this, chart);   // keep default click behaviour

  if (!isCumulative) return labels;                // nothing to do

  labels.forEach(lbl => {
    const ds   = chart.data.datasets[lbl.datasetIndex];
    const data = ds.data;
    const last = (Array.isArray(data) && data.length)
                 ? data[data.length - 1]           // largest cumulative value
                 : 0;
    lbl.text = `${lbl.text}  (${last})`;         // append total
  });
  return labels;
}

function buildStatsLists() {
    const stats = {
        journals: {},
        conferences: {},
        keywords: {},
        authors: {},
        researchAreas: {},
        otherDetectedFeatures: {},
        modelNames: {}
    };
    const visibleRows = document.querySelectorAll('#papersTable tbody tr[data-paper-id]:not(.filter-hidden)');
    visibleRows.forEach(row => {
        // --- Get Journal/Conference and Type (same as before) ---
        const journalCell = row.cells[journalCellIndex]; // Index 4 (Journal/Conf column)
        const typeCell = row.cells[typeCellIndex]; // Index 5 (Type column) - Assuming typeCellIndex is defined globally
        if (journalCell && typeCell) { // Ensure cells exist
            const journalConfName = journalCell.textContent.trim();
            const typeValue = (typeCell.getAttribute('title') || typeCell.textContent.trim()).toLowerCase(); // Use title if available, standardize case
            if (journalConfName) {
                // Determine if it's a journal or conference based on type
                // Common BibTeX types: 'article' -> journal, 'inproceedings', 'proceedings', 'conference' -> conference
                if (typeValue === 'article') {
                    stats.journals[journalConfName] = (stats.journals[journalConfName] || 0) + 1;
                } else if (typeValue === 'inproceedings' || typeValue === 'proceedings' || typeValue === 'conference') {
                    stats.conferences[journalConfName] = (stats.conferences[journalConfName] || 0) + 1;
                } else {
                    // Optional: Handle other types or log them if needed
                    // console.log(`Unrecognized type for ${journalConfName}: ${typeValue}`);
                    // You could add them to a 'miscellaneous' category if desired
                }
            }
        }

        // --- Get data from hidden cells ---
        // Find the hidden cells by their data-field attribute within the current row
        const keywordsCell = row.querySelector('td[data-field="keywords"]');
        const authorsCell = row.querySelector('td[data-field="authors"]');
        const researchAreaCell = row.querySelector('td[data-field="research_area"]');
        const modelNameCell = row.querySelector('td[data-field="model_name"]');
        const featuresOtherCell = row.querySelector('td[data-field="features_other"]');

        // Extract text content from the found cells
        const keywordsText = keywordsCell ? keywordsCell.textContent.trim() : '';
        const authorsText = authorsCell ? authorsCell.textContent.trim() : '';
        const researchAreaText = researchAreaCell ? researchAreaCell.textContent.trim() : '';
        const modelNameText = modelNameCell ? modelNameCell.textContent.trim() : '';
        const featuresOtherText = featuresOtherCell ? featuresOtherCell.textContent.trim() : '';

        // --- Process Keywords ---
        if (keywordsText) {
            const keywordsList = keywordsText.split(';')
                .map(kw => kw.trim())
                .filter(kw => kw.length > 0);
            keywordsList.forEach(keyword => {
                stats.keywords[keyword] = (stats.keywords[keyword] || 0) + 1;
            });
        }

        // --- Process Authors ---
        if (authorsText) {
            const authorsList = authorsText.split(';')
                .map(author => author.trim())
                .filter(author => author.length > 0);
            authorsList.forEach(author => {
                stats.authors[author] = (stats.authors[author] || 0) + 1;
            });
        }

        // --- Process Research Area ---
        if (researchAreaText) {
            stats.researchAreas[researchAreaText] = (stats.researchAreas[researchAreaText] || 0) + 1;
        }

        // --- Process Other Detected Features ---
        if (featuresOtherText) {
            const featuresList = featuresOtherText.split(';')
                .map(f => f.trim())
                .filter(f => f.length > 0);
            featuresList.forEach(feature => {
                stats.otherDetectedFeatures[feature] = (stats.otherDetectedFeatures[feature] || 0) + 1;
            });
        }

        // --- Process Model Names ---
        if (modelNameText) {
            const modelNamesList = modelNameText.split(/[,;]/) // Split by comma or semicolon
                .map(m => m.trim())
                .filter(m => m.length > 0);
            modelNamesList.forEach(modelName => {
                stats.modelNames[modelName] = (stats.modelNames[modelName] || 0) + 1;
            });
        }
    });

    // Function to populate lists where items must appear more than once (count > 1)
    function populateList(listElementId, dataObj) {
        const listElement = document.getElementById(listElementId);
        if (!listElement) {
            console.warn(`List element with ID ${listElementId} not found.`);
            return;
        }
        listElement.innerHTML = '';
        const sortedEntries = Object.entries(dataObj)
            .filter(([name, count]) => count >= 1) // Keep only entries with count >= 1 (changed from > 1 if desired)
            .sort((a, b) => {
                if (b[1] !== a[1]) {
                    return b[1] - a[1];
                }
                return a[0].localeCompare(b[0]);
            });
        if (sortedEntries.length === 0) {
            listElement.innerHTML = '<li>No items with count >= 1.</li>'; // Changed message
            return;
        }
        sortedEntries.forEach(([name, count]) => {
            const listItem = document.createElement('li');
            // Escape HTML to prevent XSS if data contains special characters
            const escapedName = name.replace(/&/g, "&amp;").replace(/</g, "<").replace(/>/g, ">");
            const escapedNameForTitle = escapedName.replace(/"/g, "&quot;"); // Escape quotes for title attribute
            // Create the list item content with count, search button, and name
            listItem.innerHTML = `<span class="count">${count}</span><button type="button" class="search-item-btn" title="Search for &quot;${escapedNameForTitle}&quot;">🔍</button><span class="name">${escapedName}</span>`;
            listElement.appendChild(listItem);
        });
        listElement.querySelectorAll('.search-item-btn').forEach(button => {
            button.addEventListener('click', function() {
                const listItem = this.closest('li');
                const nameSpan = listItem.querySelector('.name');
                if (nameSpan) {
                    const searchTerm = nameSpan.textContent.trim();
                    searchInput.value = searchTerm; // Set the search input value
                    closeModal(); // Close the stats modal
                    applyLocalFilters(); // Trigger the filter update
                }
            });
        });
    }

    // Function to populate lists where items *can* appear only once (no >= 1 filter)
    function populateSimpleList(listElementId, dataObj) {
        const listElement = document.getElementById(listElementId);
        if (!listElement) {
            console.warn(`List element with ID ${listElementId} not found.`);
            return;
        }
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
            const escapedNameForTitle = escapedName.replace(/"/g, "&quot;"); // Escape quotes for title attribute
            // Create the list item content with count, search button, and name
            listItem.innerHTML = `<span class="count">${count}</span><button type="button" class="search-item-btn" title="Search for &quot;${escapedNameForTitle}&quot;">🔍</button><span class="name">${escapedName}</span>`;
            listElement.appendChild(listItem);
        });
        listElement.querySelectorAll('.search-item-btn').forEach(button => {
            button.addEventListener('click', function() {
                const listItem = this.closest('li');
                const nameSpan = listItem.querySelector('.name');
                if (nameSpan) {
                    const searchTerm = nameSpan.textContent.trim();
                    searchInput.value = searchTerm; // Set the search input value
                    closeModal(); // Close the stats modal
                    applyLocalFilters(); // Trigger the filter update
                }
            });
        });
    }

    populateList('keywordStatsList', stats.keywords);
    populateList('authorStatsList', stats.authors);
    populateList('researchAreaStatsList', stats.researchAreas);
    populateSimpleList('otherDetectedFeaturesStatsList', stats.otherDetectedFeatures);
    populateSimpleList('modelNamesStatsList', stats.modelNames);

    // ---- now the lists exist; build cloud if switch is on ----
    if (document.getElementById('cloudToggle').checked) {
        toggleCloud();                     // first render
    }
}

// static/stats.js
// ... (previous code remains unchanged until the displayStats function)

function displayStats() {
    document.documentElement.classList.add('busyCursor');
    setTimeout(() => {
        updateCounts(); // Run updateCounts to get the latest data for visible rows
        TECHNIQUE_FIELDS_FOR_YEARLY.forEach((field, index) => { TECHNIQUE_FIELD_COLOR_MAP[field] = index; });
        FEATURE_FIELDS_FOR_YEARLY.forEach((field, index) => { FEATURE_FIELD_INDEX_MAP[field] = index; });
        // Populate the groups with the actual feature fields
        FEATURE_FIELDS_FOR_YEARLY.forEach(field => {
            const originalIndex = FEATURE_FIELD_INDEX_MAP[field];
            const originalColorHSLA = featuresColorsOriginalOrder[originalIndex];
            // Find the base color index that matches this feature's color:
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

        // --- Calculate SMT vs THT Data ---
        const smtCount = latestCounts['is_smt'] || 0;
        const thtCount = latestCounts['is_through_hole'] || 0;
        const smtVsThtDistChartData = {
            labels: ['SMT', 'THT'],
            datasets: [{
                label: 'SMT vs THT Distribution',
                data: [smtCount, thtCount],
                backgroundColor: [
                    'hsla(180, 32%, 52%, 0.95)', // Teal (from techniques)
                    'hsla(260, 60%, 66%, 0.95)'  // Purple (from techniques)
                ],
                borderColor: "#333",
                borderWidth: 1,
                hoverOffset: 4
            }]
        };

        // --- Calculate Offtopic (Scope) Data ---
        // Get the total number of currently visible papers directly
        const visibleRows = document.querySelectorAll('#papersTable tbody tr[data-paper-id]:not(.filter-hidden)');
        const totalVisiblePaperCount = visibleRows.length;
        // Get the total number of *all* papers from the footer cell
        const totalPaperCountCell = document.getElementById('total-papers-count');
        const totalAllPaperCount = totalPaperCountCell ? parseInt(totalPaperCountCell.textContent.trim(), 10) : 0;
        // const offtopicCount = latestCounts['is_offtopic'] || 0;
        const offtopicCount = totalAllPaperCount;
        // On-topic count is visible papers minus off-topic papers
        const ontopicCount = totalVisiblePaperCount;
        const scopeDistChartData = {
            labels: ['Filtered', 'Total'],
            datasets: [{
                label: 'Dataset Scope (On-topic vs Off-topic)',
                data: [ontopicCount, offtopicCount],
                backgroundColor: [
                    'hsla(96, 66%, 49%, 0.95)', // Green (from techniques)
                    'hsla(347, 60%, 69%, 0.95)'  // Red (from techniques)
                ],
                borderColor: "#333",
                borderWidth: 1,
                hoverOffset: 4
            }]
        };

        // --- Prepare Features Distribution Chart Data (Original or Grouped) ---
        let featuresChartData;
        if (showPieCharts) {
            // --- Grouped Data for Pie Chart ---
            // Calculate aggregated values based on featureColorGroups
            const groupedLabels = [];
            const groupedValues = [];
            const groupedBackgroundColors = [];
            // const groupedBorderColors = [];
            // Iterate through the defined groups
            Object.keys(featureColorGroups).forEach(baseColorIndex => {
                const group = featureColorGroups[baseColorIndex];
                groupedLabels.push(group.label); // Use the group's label (e.g., 'PCB Features')
                // Sum the counts for all features within this group
                let groupSum = 0;
                group.fields.forEach(field => {
                    groupSum += getCountFromFooter(field);
                });
                groupedValues.push(groupSum);
                // Use the color associated with the base index for this group
                const colorIndex = parseInt(baseColorIndex);
                groupedBackgroundColors.push(featuresColorsOriginalOrder[colorIndex]);
                // groupedBorderColors.push(featuresBorderColorsOriginalOrder[colorIndex]);
            });
            featuresChartData = {
                labels: groupedLabels,
                datasets: [{
                    label: 'Features Count (Grouped)',
                    data: groupedValues,
                    backgroundColor: groupedBackgroundColors,
                    borderColor: "#333",         // fixed color as the translucent mapping lacks contrast for bar or pie charts
                    borderWidth: 1,
                    hoverOffset: 4
                }]
            };
        } else {
            // --- Original Data for Bar Chart ---
            const featuresLabels = FEATURE_FIELDS.map(field => FIELD_LABELS[field] || field);
            const featuresValues = FEATURE_FIELDS.map(field => getCountFromFooter(field));
            const featuresBackgroundColors = featuresColorsOriginalOrder; // Use original colors
            // const featuresBorderColors = featuresBorderColorsOriginalOrder; // Use original border colors
            featuresChartData = {
                labels: featuresLabels,
                datasets: [{
                    label: 'Features Count',
                    data: featuresValues,
                    backgroundColor: featuresBackgroundColors,
                    borderColor: "#333",         // fixed color as the translucent mapping lacks contrast for bar or pie charts
                    borderWidth: 1,
                    hoverOffset: 4
                }]
            };
        }

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
        // const sortedTechniquesBorderColors = techniquesData.map(item => techniquesBorderColors[item.originalIndex] || 'rgba(0,0,0,1)');
        const techniquesChartData = {
            labels: sortedTechniquesLabels,
            datasets: [{
                label: 'Techniques Count',
                data: sortedTechniquesValues,
                backgroundColor: sortedTechniquesBackgroundColors, // Use mapped colors
                borderColor: "#333",         // fixed color as the translucent mapping lacks contrast for bar or pie charts
                borderWidth: 1,
                hoverOffset: 4
            }]
        };

        // ---  Prepare Survey vs Implementation Distribution Chart Data ---
        // Use the correct counts from latestCounts and total visible papers
        const surveyCount = latestCounts['is_survey'] || 0;
        // Calculate implementation count: total visible - survey count
        const implCount = totalVisiblePaperCount - surveyCount;
        const surveyVsImplDistChartData = {
            labels: ['Survey', 'Primary'],
            datasets: [{
                label: 'Survey vs Primary Distribution',
                data: [
                    surveyCount,
                    implCount
                ],
                backgroundColor: [
                    'hsla(204, 42%, 67%, 0.95)', // Blue (from line chart)
                    'hsla(53, 50%, 69%, 0.95)' // Red-like (from line chart, adjusted hue/lightness)
                ],
                borderColor: "#333",
                borderWidth: 1,
                hoverOffset: 4
            }]
        };

        // --- Prepare Publication Types Distribution Chart Data (Translated Labels) ---
        // Get unique types from the yearly data collected in updateCounts
        const allPubTypesSet = new Set();
        Object.values(latestYearlyData.pubTypes || {}).forEach(yearData => {
            Object.keys(yearData).forEach(type => allPubTypesSet.add(type));
        });
        const allPubTypes = Array.from(allPubTypesSet).sort(); // Sort for consistent order
        const pubTypesDistData = allPubTypes.map(type => {
            let count = 0;
            Object.values(latestYearlyData.pubTypes || {}).forEach(yearData => {
                count += yearData[type] || 0;
            });
            return count;
        });
        // Translate labels using the map
        const pubTypesDistLabels = allPubTypes.map(mapPubType);
        // Generate colors for pub types (similar to line chart logic)
        const pubTypesDistColors = allPubTypes.map((type, index) => { // Colors still use original type for consistency in generation
            const hue = (index * 137.508) % 360; // Golden angle approximation for spread
            return `hsla(${hue}, 30%, 65%, 0.85)`; // Slightly transparent for contrast
        });
        const pubTypesDistChartData = {
            labels: pubTypesDistLabels, // Use the translated labels
            datasets: [{
                label: 'Publication Types Distribution',
                data: pubTypesDistData,
                backgroundColor: pubTypesDistColors,
                borderColor: "#333",
                borderWidth: 1,
                hoverOffset: 4
            }]
        };

        // --- Prepare Relevance Histogram Data ---
        // Assuming relevance data is collected in updateCounts or similar logic
        // For now, let's assume it's collected similarly to yearly data in an object like latestYearlyData
        // We need to collect relevance scores for *visible* papers
        const relevanceCounts = Array(11).fill(0); // Index 0-10 for scores 0-10
        visibleRows.forEach(row => {
            const relevanceCell = row.cells[relevanceCellIndex]; // Assume relevanceCellIndex is defined globally
            if (relevanceCell) {
                const relevanceText = relevanceCell.textContent.trim();
                const relevanceScore = parseInt(relevanceText, 10);
                if (!isNaN(relevanceScore) && relevanceScore >= 0 && relevanceScore <= 10) {
                    relevanceCounts[relevanceScore]++;
                }
            }
        });
        const relevanceHistogramData = {
            labels: Array.from({length: 11}, (_, i) => i.toString()), // Labels "0", "1", ..., "10"
            datasets: [{
                label: 'Relevance Histogram',
                data: relevanceCounts,
                backgroundColor: 'hsla(204, 62%, 57%, 0.95)', // Blue (from techniques)
                borderColor: 'hsla(204, 82%, 28%, 0.75)', // Darker Blue border
                borderWidth: 1
            }]
        };

        // --- Prepare Estimated Score Histogram Data ---
        // Assuming estScore data is collected in updateCounts or similar logic
        // We need to collect estScore values for *visible* papers
        const estScoreCounts = Array(11).fill(0); // Index 0-10 for scores 0-10
        visibleRows.forEach(row => {
            const estScoreCell = row.cells[estScoreCellIndex]; // Assume estScoreCellIndex is defined globally
            if (estScoreCell) {
                const estScoreText = estScoreCell.textContent.trim();
                const estScore = parseInt(estScoreText, 10);
                if (!isNaN(estScore) && estScore >= 0 && estScore <= 10) {
                    estScoreCounts[estScore]++;
                }
            }
        });
        const estScoreHistogramData = {
            labels: Array.from({length: 11}, (_, i) => i.toString()), // Labels "0", "1", ..., "10"
            datasets: [{
                label: 'Estimated Score Histogram',
                data: estScoreCounts,
                backgroundColor: 'hsla(52, 80%, 47%, 0.95)', // Yellow (from techniques)
                borderColor: 'hsla(42, 100%, 28%, 0.75)', // Darker Yellow border
                borderWidth: 1
            }]
        };


        // --- Destroy existing charts if they exist (important for re-renders) ---
        if (window.featuresBarChartInstance) {
            window.featuresBarChartInstance.destroy();
            delete window.featuresBarChartInstance;
        }
        if (window.techniquesBarChartInstance) {
            window.techniquesBarChartInstance.destroy();
            delete window.techniquesBarChartInstance;
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
        if (window.pubTypesPerYearLineChartInstance) {
            window.pubTypesPerYearLineChartInstance.destroy();
            delete window.pubTypesPerYearLineChartInstance;
        }
        if (window.surveyVsImplDistChartInstance) {
            window.surveyVsImplDistChartInstance.destroy();
            delete window.surveyVsImplDistChartInstance;
        }
        if (window.pubTypesDistChartInstance) {
            window.pubTypesDistChartInstance.destroy();
            delete window.pubTypesDistChartInstance;
        }
        if (window.smtVsThtDistChartInstance) {
            window.smtVsThtDistChartInstance.destroy();
            delete window.smtVsThtDistChartInstance;
        }
        if (window.scopeDistChartInstance) {
            window.scopeDistChartInstance.destroy();
            delete window.scopeDistChartInstance;
        }
        if (window.relevanceHistogramInstance) {
            window.relevanceHistogramInstance.destroy();
            delete window.relevanceHistogramInstance;
        }
        if (window.estScoreHistogramInstance) {
            window.estScoreHistogramInstance.destroy();
            delete window.estScoreHistogramInstance;
        }


        const featuresCtx = document.getElementById('featuresPieChart')?.getContext('2d');
        const techniquesCtx = document.getElementById('techniquesPieChart')?.getContext('2d');
        const surveyVsImplCtx = document.getElementById('surveyVsImplLineChart')?.getContext('2d');
        const techniquesPerYearCtx = document.getElementById('techniquesPerYearLineChart')?.getContext('2d');
        const featuresPerYearCtx = document.getElementById('featuresPerYearLineChart')?.getContext('2d');
        const pubTypesPerYearCtx = document.getElementById('pubTypesPerYearLineChart')?.getContext('2d'); // Get context for pub types chart
        const surveyVsImplDistCtx = document.getElementById('surveyVsImplPieChart')?.getContext('2d');
        const pubTypesDistCtx = document.getElementById('publTypePieChart')?.getContext('2d');
        const smtVsThtCtx = document.getElementById('SMTvsTHTPieChart')?.getContext('2d');
        const relevanceHistogramCtx = document.getElementById('RelevanceHistogram')?.getContext('2d');
        const estScoreHistogramCtx = document.getElementById('estScoreHistogram')?.getContext('2d');
        const scopeCtx = document.getElementById('OffTopicPieChart')?.getContext('2d');
        // do this ONCE, before you call new Chart()

        Chart.defaults.font = {
            size: 12.5,
            family: 'Arial Narrow',
            weight: '300'
        };

        // --- Render Features Distribution Chart (Bar or Pie) ---
        const featuresChartType = showPieCharts ? 'pie' : 'bar';
        const featuresChartOptions = {
            type: featuresChartType,
            data: featuresChartData,
            options: {
                // Conditionally apply indexAxis for bar chart, omit for pie
                ...(featuresChartType === 'bar' ? { indexAxis: 'y' } : {}),
                ...(featuresChartType === 'pie' ? { radius: '90%' } : {}), // Adjust '80%' as needed (e.g., '70%', '90%')
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: featuresChartType === 'pie', // Show legend only for pie charts
                        position: 'top', // Position legend differently for pie
                        labels: {
                            usePointStyle: featuresChartType == 'pie', // Use point style for bar chart markers, not pie
                            pointStyle: 'circle',
                        }
                    },
                    title: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                // Show count for both bar and pie
                                return `${context.label}: ${context.raw}`;
                            }
                        }
                    }
                },
                // Only apply scales for bar chart
                ...(featuresChartType === 'bar' ? {
                    scales: {
                        x: {
                            beginAtZero: true,
                            ticks: { precision: 0 }
                        }
                    }
                } : {})
            }
        };
        window.featuresBarChartInstance = new Chart(featuresCtx, featuresChartOptions); // Keep variable name for consistency if needed, or rename to featuresChartInstance

        // --- Render Techniques Distribution Chart (Bar or Pie) ---
        const techniquesChartType = showPieCharts ? 'pie' : 'bar';
        const techniquesChartOptions = {
            type: techniquesChartType,
            data: techniquesChartData, // Uses sortedTechniques* with mapped colors
            options: {
                // Conditionally apply indexAxis for bar chart, omit for pie
                ...(techniquesChartType === 'bar' ? { indexAxis: 'y' } : {}),
                ...(featuresChartType === 'pie' ? { radius: '90%' } : {}), // Adjust '80%' as needed (e.g., '70%', '90%')
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: featuresChartType === 'pie', // Show legend only for pie charts
                        position: 'top', // Position legend differently for pie
                        labels: {
                            usePointStyle: techniquesChartType == 'pie', // Use point style for bar chart markers, not pie
                            pointStyle: 'circle'
                        }
                    },
                    title: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                // Show count for both bar and pie
                                return `${context.label}: ${context.raw}`;
                            }
                        }
                    }
                },
                // Only apply scales for bar chart
                ...(techniquesChartType === 'bar' ? {
                    scales: {
                        x: {
                            beginAtZero: true,
                            ticks: { precision: 0 }
                        }
                    }
                } : {})
            }
        };
        window.techniquesBarChartInstance = new Chart(techniquesCtx, techniquesChartOptions); // Keep variable name for consistency if needed, or rename to techniquesChartInstance

        // --- Render Survey vs Implementation Distribution Chart (Bar or Pie) ---
        const surveyVsImplDistChartType = showPieCharts ? 'pie' : 'bar';
        const surveyVsImplDistChartOptions = {
            type: surveyVsImplDistChartType,
            data: surveyVsImplDistChartData,
            options: {
                // Conditionally apply indexAxis for bar chart, omit for pie
                ...(surveyVsImplDistChartType === 'bar' ? { indexAxis: 'y' } : {}),
                ...(surveyVsImplDistChartType === 'pie' ? { radius: '90%' } : {}), // Adjust '80%' as needed (e.g., '70%', '90%')
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: surveyVsImplDistChartType === 'pie', // Show legend only for pie charts
                        position: 'top', // Position legend differently for pie
                        labels: {
                            usePointStyle: surveyVsImplDistChartType == 'pie', // Use point style for bar chart markers, not pie
                            pointStyle: 'circle',
                        }
                    },
                    title: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                // Show count for both bar and pie
                                return `${context.label}: ${context.raw}`;
                            }
                        }
                    }
                },
                // Only apply scales for bar chart
                ...(surveyVsImplDistChartType === 'bar' ? {
                    scales: {
                        x: {
                            beginAtZero: true,
                            ticks: { precision: 0 }
                        }
                    }
                } : {})
            }
        };
        window.surveyVsImplDistChartInstance = new Chart(surveyVsImplDistCtx, surveyVsImplDistChartOptions);

        // --- Render Publication Types Distribution Chart (Bar or Pie) ---
        const pubTypesDistChartType = showPieCharts ? 'pie' : 'bar';
        const pubTypesDistChartOptions = {
            type: pubTypesDistChartType,
            data: pubTypesDistChartData,
            options: {
                // Conditionally apply indexAxis for bar chart, omit for pie
                ...(pubTypesDistChartType === 'bar' ? { indexAxis: 'y' } : {}),
                ...(pubTypesDistChartType === 'pie' ? { radius: '90%' } : {}), // Adjust '80%' as needed (e.g., '70%', '90%')
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: pubTypesDistChartType === 'pie', // Show legend only for pie charts
                        position: 'top', // Position legend differently for pie
                        labels: {
                            usePointStyle: pubTypesDistChartType == 'pie', // Use point style for bar chart markers, not pie
                            pointStyle: 'circle',
                        }
                    },
                    title: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                // Show count for both bar and pie
                                return `${context.label}: ${context.raw}`;
                            }
                        }
                    }
                },
                // Only apply scales for bar chart
                ...(pubTypesDistChartType === 'bar' ? {
                    scales: {
                        x: {
                            beginAtZero: true,
                            ticks: { precision: 0 }
                        }
                    }
                } : {})
            }
        };
        window.pubTypesDistChartInstance = new Chart(pubTypesDistCtx, pubTypesDistChartOptions);

        // --- Render SMT vs THT Distribution Chart (Bar or Pie) ---
        const smtVsThtDistChartType = showPieCharts ? 'pie' : 'bar';
        const smtVsThtDistChartOptions = {
            type: smtVsThtDistChartType,
            data: smtVsThtDistChartData,
            options: {
                // Conditionally apply indexAxis for bar chart, omit for pie
                ...(smtVsThtDistChartType === 'bar' ? { indexAxis: 'y' } : {}),
                ...(smtVsThtDistChartType === 'pie' ? { radius: '90%' } : {}), // Adjust '80%' as needed (e.g., '70%', '90%')
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: smtVsThtDistChartType === 'pie', // Show legend only for pie charts
                        position: 'top', // Position legend differently for pie
                        labels: {
                            usePointStyle: smtVsThtDistChartType == 'pie', // Use point style for bar chart markers, not pie
                            pointStyle: 'circle',
                        }
                    },
                    title: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                // Show count for both bar and pie
                                return `${context.label}: ${context.raw}`;
                            }
                        }
                    }
                },
                // Only apply scales for bar chart
                ...(smtVsThtDistChartType === 'bar' ? {
                    scales: {
                        x: {
                            beginAtZero: true,
                            ticks: { precision: 0 }
                        }
                    }
                } : {})
            }
        };
        window.smtVsThtDistChartInstance = new Chart(smtVsThtCtx, smtVsThtDistChartOptions);

        // --- Render Scope (Offtopic) Distribution Chart (Bar or Pie) ---
        const scopeDistChartType = showPieCharts ? 'pie' : 'bar';
        const scopeDistChartOptions = {
            type: scopeDistChartType,
            data: scopeDistChartData,
            options: {
                // Conditionally apply indexAxis for bar chart, omit for pie
                ...(scopeDistChartType === 'bar' ? { indexAxis: 'y' } : {}),
                ...(scopeDistChartType === 'pie' ? { radius: '90%' } : {}), // Adjust '80%' as needed (e.g., '70%', '90%')
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: scopeDistChartType === 'pie', // Show legend only for pie charts
                        position: 'top', // Position legend differently for pie
                        labels: {
                            usePointStyle: scopeDistChartType == 'pie', // Use point style for bar chart markers, not pie
                            pointStyle: 'circle',
                        }
                    },
                    title: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                // Show count for both bar and pie
                                return `${context.label}: ${context.raw}`;
                            }
                        }
                    }
                },
                // Only apply scales for bar chart
                ...(scopeDistChartType === 'bar' ? {
                    scales: {
                        x: {
                            beginAtZero: true,
                            ticks: { precision: 0 }
                        }
                    }
                } : {})
            }
        };
        window.scopeDistChartInstance = new Chart(scopeCtx, scopeDistChartOptions);

        // --- Render Relevance Histogram ---
        const relevanceHistogramOptions = {
            type: 'bar',
            data: relevanceHistogramData,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: { display: false, text: 'Relevance Histogram' }
                },
                scales: {
                    x: {
                        title: {
                            display: false,
                            text: 'Relevance Score'
                        },
                        ticks: { precision: 0 }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Frequency'
                        },
                        beginAtZero: true,
                        ticks: { precision: 0 }
                    }
                }
            }
        };
        window.relevanceHistogramInstance = new Chart(relevanceHistogramCtx, relevanceHistogramOptions);

        // --- Render Estimated Score Histogram ---
        const estScoreHistogramOptions = {
            type: 'bar',
            data: estScoreHistogramData,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: { display: false, text: 'Estimated Score Histogram' }
                },
                scales: {
                    x: {
                        title: {
                            display: false,
                            text: 'Estimated Score'
                        },
                        ticks: { precision: 0 }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Frequency'
                        },
                        beginAtZero: true,
                        ticks: { precision: 0 }
                    }
                }
            }
        };
        window.estScoreHistogramInstance = new Chart(estScoreHistogramCtx, estScoreHistogramOptions);


        // --- Render Line Charts ---
        // 1. Survey vs Implementation Papers per Year
        const surveyImplData = latestYearlyData.surveyImpl || {};
        const yearsForSurveyImpl = Object.keys(surveyImplData).map(Number).sort((a, b) => a - b);
        const surveyCounts = yearsForSurveyImpl.map(year => surveyImplData[year].surveys || 0);
        const implCounts = yearsForSurveyImpl.map(year => surveyImplData[year].impl || 0);
        let surveyCountsFinal = surveyCounts;
        let implCountsFinal = implCounts;
        if (isCumulative) {
            surveyCountsFinal = calculateCumulativeData(surveyCounts);
            implCountsFinal = calculateCumulativeData(implCounts);
        }
        window.surveyVsImplLineChartInstance = new Chart(surveyVsImplCtx, {
            type: 'line',
            data: {
                labels: yearsForSurveyImpl,
                datasets: [
                    {
                        label: 'Survey Papers',
                        data: surveyCountsFinal, // Use final data array
                        borderColor: 'hsl(204, 42%, 37%)', // Blue
                        backgroundColor: 'hsla(204, 42%, 67%, 0.95)',
                        fill: isStacked, // Fill is controlled by stacked option below
                        tension: 0.25
                    },
                    {
                        label: 'Primary Papers',
                        data: implCountsFinal, // Use final data array
                        borderColor: 'hsla(38, 70%, 49%, 1.00)', // Red
                        backgroundColor: 'hsla(42, 50%, 69%, 0.95)',
                        fill: isStacked, // Fill is controlled by stacked option below
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
                            pointStyle: 'circle',  // Specify the circle style
                            generateLabels: cumulativeLegendLabels   // <-- added
                        }
                    },
                    title: { display: false, text: 'Survey vs Primary Papers per Year' },
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
                        stacked: isStacked // Apply stacking to Y-axis
                    },
                    x: {
                        ticks: { precision: 0 },
                        stacked: isStacked // Apply stacking to X-axis if needed (usually not for line charts, but for bar compatibility)
                    }
                }
            }
        });

        // 2. Techniques per Year (Consistent Colors)
        const techniquesYearlyData = latestYearlyData.techniques || {};
        const yearsForTechniques = Object.keys(techniquesYearlyData).map(Number).sort((a, b) => a - b);
        // Create datasets for the line chart using the ORIGINAL field order and ORIGINAL colors
        // This ensures color consistency regardless of sorting in the bar chart
        const techniqueLineDatasets = TECHNIQUE_FIELDS_FOR_YEARLY.map(field => {
            const label = (typeof FIELD_LABELS !== 'undefined' && FIELD_LABELS[field]) ? FIELD_LABELS[field] : field;
            let data = yearsForTechniques.map(year => techniquesYearlyData[year]?.[field] || 0);
            if (isCumulative) {
                data = calculateCumulativeData(data);
            }
            const originalIndex = TECHNIQUE_FIELD_COLOR_MAP[field] !== undefined ? TECHNIQUE_FIELD_COLOR_MAP[field] : -1;
            // --- FIX: Use techniquesBorderColors for border, techniquesColors for background ---
            const borderColor = (originalIndex !== -1 && techniquesBorderColors[originalIndex]) ? techniquesBorderColors[originalIndex] : 'rgba(0, 0, 0, 1)'; // Use border colors array
            const backgroundColor = (originalIndex !== -1 && techniquesColors[originalIndex]) ? techniquesColors[originalIndex] : 'rgba(0, 0, 0, 0.1)'; // Use fill colors array (usually with alpha for line charts when stacked)
            return {
                label: label,
                data: data, // Use final data array
                borderColor: borderColor,       // Use the dedicated border color
                backgroundColor: backgroundColor, // Use the dedicated fill color (often with alpha)
                fill: isStacked, // Fill is controlled by stacked option below
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
                                pointStyle: 'circle',  // Specify the circle style
                                generateLabels: cumulativeLegendLabels   // <-- added
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
                        y: {
                            beginAtZero: true,
                            ticks: { precision: 0 },
                            stacked: isStacked // Apply stacking to Y-axis
                        },
                        x: {
                            ticks: { precision: 0 },
                            stacked: isStacked // Apply stacking to X-axis if needed
                        }
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
        const aggregatedFeatureDataByColorFinal = {};
        Object.keys(aggregatedFeatureDataByColor).forEach(label => {
            let data = aggregatedFeatureDataByColor[label];
            if (isCumulative) {
                data = calculateCumulativeData(data);
            }
            aggregatedFeatureDataByColorFinal[label] = data;
        });
        // Create datasets for the line chart using the aggregated data and corresponding colors
        const featureLineDatasets = Object.keys(featureColorGroups).map(baseColorIndex => {
            const group = featureColorGroups[baseColorIndex];
            const colorIndex = parseInt(baseColorIndex); // Use the base color index to get the actual color
            // --- FIX: Use featuresBorderColorsOriginalOrder for border, featuresColorsOriginalOrder for background ---
            const borderColor = (featuresBorderColorsOriginalOrder[colorIndex]) ? featuresBorderColorsOriginalOrder[colorIndex] : 'rgba(0, 0, 0, 1)'; // Use border colors array
            const backgroundColor = (featuresColorsOriginalOrder[colorIndex]) ? featuresColorsOriginalOrder[colorIndex] : 'rgba(0, 0, 0, 0.1)'; // Use fill colors array (usually with alpha for line charts when stacked)
            // --- END FIX ---
            return {
                label: group.label,
                data: aggregatedFeatureDataByColorFinal[group.label], // Use final data array
                borderColor: borderColor,       // Use the dedicated border color
                backgroundColor: backgroundColor, // Use the dedicated fill color (often with alpha)
                fill: isStacked, // Fill is controlled by stacked option below
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
                                pointStyle: 'circle',  // Specify the circle style
                                generateLabels: cumulativeLegendLabels   // <-- added
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
                        y: {
                            beginAtZero: true,
                            ticks: { precision: 0 },
                            stacked: isStacked // Apply stacking to Y-axis
                        },
                        x: {
                            ticks: { precision: 0 },
                            stacked: isStacked // Apply stacking to X-axis if needed
                        }
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

        // --- 4. Publication Types per Year (Translated Labels) ---
        const pubTypesYearlyData = latestYearlyData.pubTypes || {};
        const yearsForPubTypes = Object.keys(pubTypesYearlyData).map(Number).sort((a, b) => a - b);
        // Create datasets for the line chart, one for each publication type
        const pubTypeLineDatasets = allPubTypes.map((type, index) => { // Use original types for data fetching
            // Generate a distinct color for each type (simple hue rotation)
            // You might want to use a more sophisticated color palette
            const hue = (index * 137.508) % 360; // Golden angle approximation for spread
            const borderColor = `hsl(${hue}, 40%, 40%)`;
            const backgroundColor = `hsla(${hue}, 30%, 65%, 0.85)`;
            let data = yearsForPubTypes.map(year => pubTypesYearlyData[year]?.[type] || 0);
            if (isCumulative) {
                data = calculateCumulativeData(data);
            }
            return {
                label: mapPubType(type),
                data: data, // Use final data array
                borderColor: borderColor,
                backgroundColor: backgroundColor,
                fill: isStacked, // Fill is controlled by stacked option below
                tension: 0.25,
                hidden: false // Start visible
            };
        });

        // --- Render the Publication Types per Year Line Chart ---
        if (pubTypesPerYearCtx && pubTypeLineDatasets.length > 0) {
            window.pubTypesPerYearLineChartInstance = new Chart(pubTypesPerYearCtx, {
                type: 'line',
                data: {
                    labels: yearsForPubTypes, // Use sorted years
                    datasets: pubTypeLineDatasets // Use datasets prepared above (with mapped labels)
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: {
                                usePointStyle: true,
                                pointStyle: 'circle',
                                generateLabels: cumulativeLegendLabels
                            }
                        },
                        title: { display: false, text: 'Publication Types per Year' },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    // Tooltip will now show the mapped label (e.g., "Journal", "Conference")
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
                                display: false,
                                text: 'Count'
                            },
                            stacked: isStacked // Apply stacking to Y-axis
                        },
                        x: {
                            ticks: { precision: 0 },
                            title: {
                                display: false,
                                text: 'Year'
                            },
                            stacked: isStacked // Apply stacking to X-axis if needed
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
        const { journals, conferences } = calculateJournalConferenceStats();
        
        // --- Populate Client-side Journal/Conference Lists ---
        function populateListFromClient(listElementId, dataArray) { //for items with count >=2
            const listElement = document.getElementById(listElementId);
            listElement.innerHTML = '';
            if (!dataArray || dataArray.length === 0) {
                listElement.innerHTML = '<li><span class="count"><span class="name">No items with count > 1.</span></li>';
                return;
            }
            dataArray.forEach(item => {
                const listItem = document.createElement('li');
                const escapedName = (item.name || '').toString()
                    .replace(/&/g, "&amp;").replace(/</g, "<")
                    .replace(/>/g, ">").replace(/"/g, "&quot;")
                    .replace(/'/g, "&#39;");
                // --- Preserve Original Structure ---
                const countSpan = document.createElement('span');
                countSpan.className = 'count';
                countSpan.textContent = item.count;
                const nameSpan = document.createElement('span');
                nameSpan.className = 'name';
                nameSpan.textContent = escapedName;
                const searchButton = document.createElement('button');
                searchButton.type = 'button';
                searchButton.className = 'search-item-btn';
                searchButton.title = `Search for "${item.name}"`;
                searchButton.textContent = '🔍';
                searchButton.addEventListener('click', function(event) {
                    event.stopPropagation();
                    searchInput.value = item.name;
                    closeModal();
                    const inputEvent = new Event('input', { bubbles: true });
                    searchInput.dispatchEvent(inputEvent);
                });
                listItem.appendChild(countSpan);
                listItem.appendChild(searchButton);
                listItem.appendChild(nameSpan);
                listElement.appendChild(listItem);
            });
        }
        populateListFromClient('journalStatsList', journals);
        populateListFromClient('conferenceStatsList', conferences); 
        // --- Populate Metrics Table ---
        function populateMetricsTableDirectly() {
            const tableElement = document.getElementById('metricsTableStatsList');
            if (!tableElement) {
                console.error("Metrics table element with ID 'metricsTableStatsList' not found.");
                return;
            }
            // Clear previous content
            tableElement.innerHTML = '';
            // Calculate metrics based on latestCounts and the lists already assumed to be populated
            const distinctJournalsCount = journals.length; // Client-side calculation
            const distinctConferencesCount = conferences.length; // Client-side calculation
            const authorListElement = document.getElementById('authorStatsList');
            let distinctAuthorsCount = 0;
            if (authorListElement) {
                distinctAuthorsCount = authorListElement.querySelectorAll('li').length;
            } else {
                console.warn("Author stats list element with ID 'authorStatsList' not found for counting authors.");
            }
            // Count papers providing datasets
            const papersWithDatasetCount = latestCounts['technique_available_dataset'] || 0;
            // Create table rows - Modified to support HTML in the label
            const createRow = (labelHtml, value) => {
                const row = document.createElement('tr');
                const labelCell = document.createElement('td');
                labelCell.innerHTML = labelHtml; // Use innerHTML for formatted labels
                const valueCell = document.createElement('td');
                valueCell.innerHTML = '<strong>' + value + '</strong>'; // Use innerHTML for bold value
                labelCell.className = 'metric-label';
                valueCell.className = 'metric-value';
                row.appendChild(labelCell);
                row.appendChild(valueCell);
                return row;
            };
            // Select only VISIBLE main rows for counting '✔️' and calculating visible count
            const visibleRows = document.querySelectorAll('#papersTable tbody tr[data-paper-id]:not(.filter-hidden)');
            const visiblePaperCount = visibleRows.length;
            // Append rows to the table
            tableElement.appendChild(createRow('Total <strong>filtered</strong> articles:', visiblePaperCount));
            tableElement.appendChild(createRow('Total unique <strong>journals</strong>:', distinctJournalsCount));
            tableElement.appendChild(createRow('Total unique <strong>conferences</strong>:', distinctConferencesCount));
            tableElement.appendChild(createRow('Total unique <strong>authors</strong>:', distinctAuthorsCount)); // Relies on pre-populated list
            tableElement.appendChild(createRow('Articles mentioning <strong>available dataset</strong>:', papersWithDatasetCount));
        }
        populateMetricsTableDirectly();
        // // ---- now the lists exist; build cloud if switch is on ----
        // if (document.getElementById('cloudToggle').checked) {
        //     toggleCloud();                     // first render
        // }
        // Trigger reflow to ensure styles are applied before adding the active class
        // This helps ensure the transition plays correctly on the first open
        modal.offsetHeight;
        // Add the active class to trigger the animation
        modal.classList.add('modal-active');
        setTimeout(() => {
            document.documentElement.classList.remove('busyCursor');
        }, 500);
    }, 0);
}

// ... (rest of the file remains unchanged)

function displayAbout(){
    modalSmall.offsetHeight;
    modalSmall.classList.add('modal-active');
}
function closeSmallModal() { modalSmall.classList.remove('modal-active'); }

function closeModal() { modal.classList.remove('modal-active'); } //for stats modal:

function buildKeywordCloud() {
    const canvas = document.querySelector('#keywordCloudCanvas canvas');
    const ctx    = canvas?.getContext('2d');
    if (!ctx) return;

    const liNodes = document.querySelectorAll('#keywordStatsList li');
    const raw = Array.from(liNodes)
                     .map(li => {
                         const nameEl  = li.querySelector('.name');
                         const countEl = li.querySelector('.count');
                         if (!nameEl || !countEl) return null;
                         return {
                             text: nameEl.textContent.trim(),
                             size: +countEl.textContent
                         };
                     })
                     .filter(Boolean);

    if (!raw.length) {  /*  empty list → wipe canvas and stop  */
        const dpr = window.devicePixelRatio || 1;
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
        return;
    }

    const top_k = raw.slice(0, 50);

    /* ----------  canvas setup for hiDPI ---------- */
    const dpr = window.devicePixelRatio || 1;

    const displayWidth = canvas.parentElement.clientWidth;   // CSS pixels
    const displayHeight = 280;                               // CSS px (matches markup)

    canvas.width = displayWidth * dpr;                       // physical px
    canvas.height = displayHeight * dpr;
    canvas.style.width = displayWidth + 'px';
    canvas.style.height = displayHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);                // auto-scale draws

    ctx.clearRect(0, 0, displayWidth, displayHeight);

    /* ----------  font scale ---------- */
    const sizeScale = d3.scaleLinear()
                        .domain([top_k[top_k.length - 1].size, top_k[0].size])
                        .range([8, 40]);

    /* ----------  cloud layout ---------- */
    const layout = d3.layout.cloud()
        .size([displayWidth, displayHeight])
        .words(top_k.map(d => ({...d, size: sizeScale(d.size)})))
        .padding(4)
        .rotate(() => (Math.random() - 0.5) * 0)
        .font('sans-serif')
        .fontSize(d => d.size)
        .on('end', draw);

    layout.start();

    function draw(words) {
        ctx.save();
        ctx.translate(displayWidth / 2, displayHeight / 2);
        words.forEach(w => {
            ctx.save();
            ctx.translate(w.x, w.y);
            ctx.rotate(w.rotate * Math.PI / 180);
            ctx.font = `${w.size}px sans-serif`;
            ctx.fillStyle = techniquesBorderColors[w.text.length % techniquesBorderColors.length];
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(w.text, 0, 0);
            ctx.restore();
        });
        ctx.restore();
    }
}


function toggleCloud() {
    const list   = document.getElementById('keywordStatsList');
    const canvas = document.getElementById('keywordCloudCanvas');
    const on     = document.getElementById('cloudToggle').checked;

    list.style.display   = on ? 'none' : 'block';
    canvas.style.display = on ? 'block' : 'none';

    if (!on) return; // ← don’t build if turning off

    const liNodes = list.querySelectorAll('li');
    if (liNodes.length === 0) return; // ← don’t build if no keywords

    buildKeywordCloud(); // ← safe to build
}

document.addEventListener('DOMContentLoaded', function () {

    const stackingToggle = document.getElementById('stackingToggle');
    const cumulativeToggle = document.getElementById('cumulativeToggle');
    const pieToggle = document.getElementById('pieToggle');
    const cloudToggle = document.getElementById('cloudToggle');

    stackingToggle.checked = false;
    cumulativeToggle.checked = false;
    pieToggle.checked = false;
    cloudToggle.checked = false; 

    statsBtn.addEventListener('click', function () {
        document.documentElement.classList.add('busyCursor');
        buildStatsLists();
        displayStats(); 
    });


    stackingToggle.addEventListener('change', function() {
        isStacked = this.checked; // Update the state variable
        // Update the chart options for stacking
        if (window.surveyVsImplLineChartInstance) {
            window.surveyVsImplLineChartInstance.options.scales.y.stacked = isStacked;
            window.surveyVsImplLineChartInstance.options.scales.x.stacked = isStacked;
            window.surveyVsImplLineChartInstance.data.datasets.forEach(dataset => {
                 dataset.fill = isStacked;
            });
            window.surveyVsImplLineChartInstance.update(); // Update the chart
        }
        if (window.techniquesPerYearLineChartInstance) {
            window.techniquesPerYearLineChartInstance.options.scales.y.stacked = isStacked;
            window.techniquesPerYearLineChartInstance.options.scales.x.stacked = isStacked;
            window.techniquesPerYearLineChartInstance.data.datasets.forEach(dataset => {
                 dataset.fill = isStacked;
            });
            window.techniquesPerYearLineChartInstance.update();
        }
        if (window.featuresPerYearLineChartInstance) {
            window.featuresPerYearLineChartInstance.options.scales.y.stacked = isStacked;
            window.featuresPerYearLineChartInstance.options.scales.x.stacked = isStacked;
            window.featuresPerYearLineChartInstance.data.datasets.forEach(dataset => {
                 dataset.fill = isStacked;
            });
            window.featuresPerYearLineChartInstance.update();
        }
        if (window.pubTypesPerYearLineChartInstance) {
            window.pubTypesPerYearLineChartInstance.options.scales.y.stacked = isStacked;
            window.pubTypesPerYearLineChartInstance.options.scales.x.stacked = isStacked;
            window.pubTypesPerYearLineChartInstance.data.datasets.forEach(dataset => {
                 dataset.fill = isStacked;
            });
            window.pubTypesPerYearLineChartInstance.update();
        }
        reorderDatasetsForStacking();
    });

    cumulativeToggle.addEventListener('change', function() {
        isCumulative = this.checked; // Update the state variable
        // Re-display the stats to recalculate data and re-render charts with the new state
        // Since data changes, we need to call displayStats again
        // However, we need to preserve the current toggle state *before* calling displayStats
        // The state variables `isStacked` and `isCumulative` are already updated by the event handler
        // So calling displayStats should work correctly with the new state.
        // We can call displayStats directly, but it might be slow if counts are recalculated.
        // A more efficient way would be to extract the chart updating logic into a separate function.
        // For now, we'll re-call displayStats, assuming the performance impact is acceptable within the modal.
        // A more efficient approach would be to store the original yearly data separately
        // and only re-calculate the cumulative/stacked data and update the datasets.
        // Let's implement the re-display approach first.
        displayStats(); // This will re-run the entire display process, including data recalculation and chart rendering
        // Note: This might cause the modal to flicker slightly or re-open if not handled carefully.
        // A more robust solution would be to refactor the chart creation logic into a separate function
        // that can be called with the current `isStacked` and `isCumulative` values without re-fetching server data.
        // For the purpose of this modification, calling displayStats is a functional solution.
        // To prevent the modal from closing if it was already open, we need to ensure the active class is maintained.
        // Since displayStats adds the class, we need to ensure the modal is still considered open.
        // The setTimeout in displayStats should handle the cursor, but the modal state might be reset.
        // A better approach might be to only update the datasets and options of the existing charts,
        // rather than recreating them entirely.
        // However, changing cumulative requires re-processing the data arrays, which is easier with a full redraw.
        // Stacking can be updated via options.update().
        // For now, let's assume calling displayStats is acceptable.
        // If flickering or performance becomes an issue, the chart update logic should be refactored.
        if (isStacked) reorderDatasetsForStacking();    //doesn't really work, though.
    });

    pieToggle.addEventListener('change', function() {
        showPieCharts = this.checked; // Update the state variable
        displayStats(); // Re-display to recreate charts with changed type
    });
    
    aboutBtn.addEventListener('click', displayAbout);
    // --- Close Modal
    spanClose.addEventListener('click', closeModal);
    smallClose.addEventListener('click', closeSmallModal);
    document.addEventListener('keydown', function (event) {
        // Check if the pressed key is 'Escape' and if the modal is currently active
        if (event.key === 'Escape') { closeModal(); closeSmallModal(); 
            if (document.body.id !== "html-export") {closeBatchModal(); closeExporthModal(); closeImportModal()} }
    });

    cloudToggle.addEventListener('change', toggleCloud);

    cloudToggle.checked = true;          // 1. UI match
    showKeywordCloud = true;             // 2. keep state in sync
    
    window.addEventListener('click', function (event) {
        if (event.target === modal || event.target === modalSmall) {
            closeModal();
            closeSmallModal();
        }
        
        if (document.body.id !== 'html-export') {
            if (event.target === batchModal || event.target === importModal || event.target === exportModal) {
                closeBatchModal();
                closeImportModal();
                closeExporthModal();
            }
        }
    });

});

