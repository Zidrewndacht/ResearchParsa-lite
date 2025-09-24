
//stats.js
/** Stats-related Functionality **/

let latestCounts = {}; // This will store the counts calculated by updateCounts
let latestYearlyData = {}; // NEW: Store yearly data for charts

// Define the fields for which we want to count '✔️':
const COUNT_FIELDS = [
    'is_offtopic', 'is_survey', 'is_through_hole', 'is_smt', 'is_x_ray', // Classification (Top-level)
    'features_tracks', 'features_holes', 'features_solder_insufficient', 'features_solder_excess',
    'features_solder_void', 'features_solder_crack', 'features_orientation', 'features_wrong_component',
    'features_missing_component', 'features_cosmetic', 'features_other_state', // Features (Nested under 'features')
    'technique_classic_cv_based', 'technique_ml_traditional',
    'technique_dl_cnn_classifier', 'technique_dl_cnn_detector', 'technique_dl_rcnn_detector',
    'technique_dl_transformer', 'technique_dl_other', 'technique_hybrid', 'technique_available_dataset', // Techniques (Nested under 'technique')
    'changed_by', 'verified', 'verified_by', 'user_comment_state' // Add these for user counting (Top-level)
];

const statsBtn = document.getElementById('stats-btn');
const aboutBtn = document.getElementById('about-btn');
const modal = document.getElementById('statsModal');
const modalSmall = document.getElementById('aboutModal');
const spanClose = document.querySelector('#statsModal .close'); // Specific close button
const smallClose = document.querySelector('#aboutModal .close'); // Specific close button

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

function displayStats() {
    
    document.documentElement.classList.add('busyCursor');
    setTimeout(() => {
        updateCounts(); // Run updateCounts to get the latest data for visible rows

        TECHNIQUE_FIELDS_FOR_YEARLY.forEach((field, index) => {
            TECHNIQUE_FIELD_COLOR_MAP[field] = index; // Map field to its original index
        });

        FEATURE_FIELDS_FOR_YEARLY.forEach((field, index) => {
            FEATURE_FIELD_INDEX_MAP[field] = index; // Map field to its original index
        });

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

        // --- Get Canvas Contexts for ALL charts ---
        const featuresCtx = document.getElementById('featuresPieChart')?.getContext('2d');
        const techniquesCtx = document.getElementById('techniquesPieChart')?.getContext('2d');
        const surveyVsImplCtx = document.getElementById('surveyVsImplLineChart')?.getContext('2d');
        const techniquesPerYearCtx = document.getElementById('techniquesPerYearLineChart')?.getContext('2d');
        const featuresPerYearCtx = document.getElementById('featuresPerYearLineChart')?.getContext('2d');

        // --- Render Features Distribution Bar Chart ---
        if (featuresCtx) {
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
        } else {
            console.warn("Canvas context for featuresPieChart not found.");
        }

        // --- Render Techniques Distribution Bar Chart (using mapped colors) ---
        if (techniquesCtx) {
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
        } else {
            console.warn("Canvas context for techniquesPieChart not found.");
        }

        // --- Render Line Charts ---
        // 1. Survey vs Implementation Papers per Year
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
                                display: false,
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

        // --- 1. FETCH SERVER STATS  ---
        const urlParams = new URLSearchParams(window.location.search);
        const statsUrl = `/get_stats?${urlParams.toString()}`;
        fetch(statsUrl).then(response => {
            return response.json();
        }).then(data => {
            if (data.status === 'success' && data.data) {
                const statsData = data.data;
                function populateListFromServer(listElementId, dataArray) { //for items with count >=2
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
                        listItem.innerHTML = `<span class="count">${item.count}</span> <span class="name">${escapedName}</span>`;
                        listElement.appendChild(listItem);
                    });
                }
                populateListFromServer('journalStatsList', statsData.journals);
                populateListFromServer('keywordStatsList', statsData.keywords);
                populateListFromServer('authorStatsList', statsData.authors);
                populateListFromServer('researchAreaStatsList', statsData.research_areas);

                function populateAllListFromServer(listElementId, dataArray) { //for ALL items, not just repeating ones
                    const listElement = document.getElementById(listElementId);
                    listElement.innerHTML = '';
                    if (!dataArray || dataArray.length === 0) {
                        listElement.innerHTML = '<li>No non-empty items found.</li>';
                        return;
                    }
                    dataArray.forEach(item => {
                        const listItem = document.createElement('li');
                        const escapedName = (item.name || '').toString()
                            .replace(/&/g, "&amp;").replace(/</g, "<")
                            .replace(/>/g, ">").replace(/"/g, "&quot;")
                            .replace(/'/g, "&#39;");
                        // Use the same format for consistency
                        listItem.innerHTML = `<span class="count">${item.count}</span> <span class="name">${escapedName}</span>`;
                        listElement.appendChild(listItem);
                    });
                }
                populateAllListFromServer('otherDetectedFeaturesStatsList', statsData.other_features_all);
                populateAllListFromServer('modelNamesStatsList', statsData.model_names_all);

            }
        })


        // Trigger reflow to ensure styles are applied before adding the active class
        // This helps ensure the transition plays correctly on the first open
        modal.offsetHeight;
        // Add the active class to trigger the animation
        modal.classList.add('modal-active');

        setTimeout(() => {
            document.documentElement.classList.remove('busyCursor');
        }, 700); 
    }, 20);
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
    // Event Listeners for Stats Modal
    statsBtn.addEventListener('click', displayStats);
    aboutBtn.addEventListener('click', displayAbout);

    // --- Close Modal
    spanClose.addEventListener('click', closeModal);
    smallClose.addEventListener('click', closeSmallModal);
    document.addEventListener('keydown', function (event) {
        // Check if the pressed key is 'Escape' and if the modal is currently active
        if (event.key === 'Escape') { closeModal(); closeSmallModal(); closeBatchModal() }
    });
    window.addEventListener('click', function (event) {
        if (event.target === modal || event.target === modalSmall || event.target === batchModal) { closeModal(); closeSmallModal(); closeBatchModal() }
    });
});