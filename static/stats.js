//stats_client.js
//This file contains client-side statistics code, shared between server-based full page and client-only HTML export.

// stats.js
/** Stats-related Functionality **/
let latestCounts = {}; // This will store the counts calculated by updateCounts
let latestYearlyData = {}; // NEW: Store yearly data for charts

// --- NEW: Add State Variables for Toggles ---
let isStacked = false; // Default state
let isCumulative = false; // Default state
// --- END NEW ---

const statsBtn = document.getElementById('stats-btn');
const aboutBtn = document.getElementById('about-btn');
const modal = document.getElementById('statsModal');
const modalSmall = document.getElementById('aboutModal');
const spanClose = document.querySelector('#statsModal .close'); // Specific close button
const smallClose = document.querySelector('#aboutModal .close'); // Specific close button

// --- Define Consistent Colors for Techniques ---
// Define the fixed color order used in the Techniques Distribution chart (sorted)
const techniquesColors = [
    'hsla(347, 50%, 69%, 0.95)', // Red - Classic CV
    'hsla(204, 62%, 57%, 0.95)',  // Blue - Traditional ML
    'hsla(42, 80%, 57%, 0.95)',  // Yellow - CNN Classifier
    'hsla(180, 32%, 52%, 0.95)',  // Teal - CNN Detector
    'hsla(260, 60%, 66%, 0.95)', // Purple - R-CNN Detector
    'hsla(30, 80%, 63%, 0.95)',  // Orange - Transformer
    'hsla(0, 0%, 68%, 0.95)',  // Grey - Other DL
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
    0: { label: 'PCB Features', fields: [] },      
    3: { label: 'Solder Defects', fields: [] },    
    8: { label: 'PCBA Issues', fields: [] },       
    12: { label: 'Cosmetic', fields: [] },          
    13: { label: 'Other', fields: [] }
};

// Map NEW field names (data-field values / structure keys) to user-friendly labels (based on your table headers)
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
        .filter(([name, count]) => count >= 2) // Filter after counting
        .sort((a, b) => b[1] - a[1]); // Sort by count descending
    const sortedConferences = Object.entries(conferenceCounts)
        .filter(([name, count]) => count >= 2) // Filter after counting
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

        // --- Prepare Features Distribution Chart Data (in original order) ---
        const featuresLabels = FEATURE_FIELDS.map(field => FIELD_LABELS[field] || field);
        const featuresValues = FEATURE_FIELDS.map(field => getCountFromFooter(field));
        const featuresChartData = {
            labels: featuresLabels,
            datasets: [{
                label: 'Features Count',
                data: featuresValues,
                backgroundColor: featuresColorsOriginalOrder, // Use original colors
                borderColor: "#222", // Use original border colors
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
                borderColor: "#222",         // Use mapped colors
                borderWidth: 1,
                hoverOffset: 4
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

        // --- Get Canvas Contexts for ALL charts ---
        const featuresCtx = document.getElementById('featuresPieChart')?.getContext('2d');
        const techniquesCtx = document.getElementById('techniquesPieChart')?.getContext('2d');
        const surveyVsImplCtx = document.getElementById('surveyVsImplLineChart')?.getContext('2d');
        const techniquesPerYearCtx = document.getElementById('techniquesPerYearLineChart')?.getContext('2d');
        const featuresPerYearCtx = document.getElementById('featuresPerYearLineChart')?.getContext('2d');
        const pubTypesPerYearCtx = document.getElementById('pubTypesPerYearLineChart')?.getContext('2d'); // Get context for pub types chart

        // --- Render Features Distribution Bar Chart ---
        window.featuresBarChartInstance = new Chart(featuresCtx, {
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

        // --- Render Techniques Distribution Bar Chart (using mapped colors) ---
        window.techniquesBarChartInstance = new Chart(techniquesCtx, {
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

        // --- Render Line Charts ---
        // 1. Survey vs Implementation Papers per Year
        const surveyImplData = latestYearlyData.surveyImpl || {};
        const yearsForSurveyImpl = Object.keys(surveyImplData).map(Number).sort((a, b) => a - b);
        const surveyCounts = yearsForSurveyImpl.map(year => surveyImplData[year].surveys || 0);
        const implCounts = yearsForSurveyImpl.map(year => surveyImplData[year].impl || 0);

        // --- NEW: Apply Cumulative Logic for Survey/Impl Chart ---
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
                        label: 'Implementation Papers',
                        data: implCountsFinal, // Use final data array
                        borderColor: 'hsl(347, 70%, 49%)', // Red
                        backgroundColor: 'hsla(347, 50%, 69%, 0.95)',
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
            // --- NEW: Apply Cumulative Logic for Techniques Chart ---
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

        // --- NEW: Apply Cumulative Logic for Features Chart ---
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
            const borderColor = `hsl(${hue}, 40%, 40%)`;
            const backgroundColor = `hsla(${hue}, 30%, 65%, 0.85)`; 
            let data = yearsForPubTypes.map(year => pubTypesYearlyData[year]?.[type] || 0);
            // --- NEW: Apply Cumulative Logic for Pub Types Chart ---
            if (isCumulative) {
                data = calculateCumulativeData(data);
            }
            // --- END NEW ---
            return {
                label: type, // Use the raw type name as label (or map if needed)
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

        //comms.s or ghpages.js (different functions depending on source!)  
        //This fetches data from server on full implementation (no detail row readily available)
        //or directly from detail row contents on HTML exports
        fetchDetailRowLists(); 
    
        // --- Populate Client-side Journal/Conference Lists ---
        function populateListFromClient(listElementId, dataArray) { //for items with count >=2
            const listElement = document.getElementById(listElementId);
            listElement.innerHTML = '';
            if (!dataArray || dataArray.length === 0) {
                listElement.innerHTML = '<li>No items with count > 1.</li>';
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
                // --- NEW: Create search button element ---
                const searchButton = document.createElement('button');
                searchButton.type = 'button';
                searchButton.className = 'search-item-btn';
                searchButton.title = `Search for "${item.name}"`;
                searchButton.textContent = '🔍';
                // --- NEW: Add click event listener to the button ---
                searchButton.addEventListener('click', function(event) {
                    event.stopPropagation();
                    searchInput.value = item.name;
                    closeModal();
                    const inputEvent = new Event('input', { bubbles: true });
                    searchInput.dispatchEvent(inputEvent);
                });
                // --- Append elements preserving the original structure ---
                listItem.appendChild(countSpan);
                listItem.appendChild(searchButton);
                listItem.appendChild(nameSpan);
                listElement.appendChild(listItem);
            });
        }
        populateListFromClient('journalStatsList', journals);
        populateListFromClient('conferenceStatsList', conferences); // Use the new ID
        // Trigger reflow to ensure styles are applied before adding the active class
        // This helps ensure the transition plays correctly on the first open
        modal.offsetHeight;
        // Add the active class to trigger the animation
        modal.classList.add('modal-active');
        setTimeout(() => {
            document.documentElement.classList.remove('busyCursor');
        }, 500); 
    }, 20);
}

document.addEventListener('DOMContentLoaded', function () {
    // Event Listeners for Stats Modal
    statsBtn.addEventListener('click', displayStats);
    // --- NEW: Add Event Listeners for Stacking and Cumulative Toggles ---
    const stackingToggle = document.getElementById('stackingToggle');
    const cumulativeToggle = document.getElementById('cumulativeToggle');

    stackingToggle.addEventListener('change', function() {
        isStacked = this.checked; // Update the state variable

        // Update the chart options for stacking
        if (window.surveyVsImplLineChartInstance) {
            window.surveyVsImplLineChartInstance.options.scales.y.stacked = isStacked;
            window.surveyVsImplLineChartInstance.options.scales.x.stacked = isStacked;
            // NEW: Update the fill property for datasets
            window.surveyVsImplLineChartInstance.data.datasets.forEach(dataset => {
                 dataset.fill = isStacked;
            });
            window.surveyVsImplLineChartInstance.update(); // Update the chart
        }
        if (window.techniquesPerYearLineChartInstance) {
            window.techniquesPerYearLineChartInstance.options.scales.y.stacked = isStacked;
            window.techniquesPerYearLineChartInstance.options.scales.x.stacked = isStacked;
             // NEW: Update the fill property for datasets
            window.techniquesPerYearLineChartInstance.data.datasets.forEach(dataset => {
                 dataset.fill = isStacked;
            });
            window.techniquesPerYearLineChartInstance.update();
        }
        if (window.featuresPerYearLineChartInstance) {
            window.featuresPerYearLineChartInstance.options.scales.y.stacked = isStacked;
            window.featuresPerYearLineChartInstance.options.scales.x.stacked = isStacked;
             // NEW: Update the fill property for datasets
            window.featuresPerYearLineChartInstance.data.datasets.forEach(dataset => {
                 dataset.fill = isStacked;
            });
            window.featuresPerYearLineChartInstance.update();
        }
        if (window.pubTypesPerYearLineChartInstance) {
            window.pubTypesPerYearLineChartInstance.options.scales.y.stacked = isStacked;
            window.pubTypesPerYearLineChartInstance.options.scales.x.stacked = isStacked;
             // NEW: Update the fill property for datasets
            window.pubTypesPerYearLineChartInstance.data.datasets.forEach(dataset => {
                 dataset.fill = isStacked;
            });
            window.pubTypesPerYearLineChartInstance.update();
        }
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
    });
    // --- END NEW ---
});