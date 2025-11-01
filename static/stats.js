// static/stats.js
/** This file contains client-side statistics code, shared between server-based full page and client-only HTML export.
 * Also includes all modal open/close logic for now.
 */
// stats.js
/** Stats-related Functionality **/

// --- State Variables ---
let latestCounts = {}; // This will store the counts calculated by updateCounts
let latestYearlyData = {};
let isStacked = false; // Default state
let isCumulative = false; // Default state
let showPieCharts = false; // Default to bar charts

// --- DOM Elements ---
const statsBtn = document.getElementById('stats-btn');
const aboutBtn = document.getElementById('about-btn');
const modal = document.getElementById('statsModal');
const modalSmall = document.getElementById('aboutModal');
const spanClose = document.querySelector('#statsModal .close'); // Specific close button
const smallClose = document.querySelector('#aboutModal .close'); // Specific close button


// --- Define Mapping for Publication Types ---
const PUB_TYPE_MAP = {
    'article': 'Journal',
    'inproceedings': 'Conference',
    // 'proceedings': 'Conference', // Example: map proceedings to Conference as well
    // 'conference': 'Conference',    // Example: map conference to Conference as well
    // // Add other BibTeX types if needed, e.g.:
    // 'techreport': 'Report',
    // 'book': 'Book',
    // 'booklet': 'Booklet',
    // 'manual': 'Manual',
    // 'mastersthesis': 'Thesis (Masters)',
    // 'phdthesis': 'Thesis (PhD)',
    // 'unpublished': 'Unpublished'
};

function mapPubType(type) {
    return PUB_TYPE_MAP[type] || type; // Return mapped value or original if not found
}

function getChartDPR() {
    const nativeDPR = window.devicePixelRatio || 1; // Fallback to 1 if API isn't available
    if (nativeDPR > 1.0 && nativeDPR < 2.0) {
        return nativeDPR * 2; // Use 2x for slightly over 1x screens to improve clarity
    }
    // Use native DPR for <= 1x or >= 2x screens
    return nativeDPR;
}

// Define the fields for which we want to count '✔️':
const COUNT_FIELDS = [
    'pdf_present',
    'pdf_annotated',
    'is_offtopic', 'is_survey',
    
    'changed_by', 'verified', 'verified_by', 'user_comment_state' // user counting (Top-level)
];

/** updateCounts() is used by filtering.js and comms.js! */
function updateCounts() { 
    const counts = {};
    const yearlySurveyImpl = {}; // { year: { surveys: count, impl: count } }
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
        const pdfCell = row.cells[pdfCellIndex];
        if (pdfCell) {
            const pdfContent = pdfCell.textContent.trim();
            // Increment counts based on the emoji in the PDF cell
            if (pdfContent === '📕') { // PDF present
                counts['pdf_present'] = (counts['pdf_present'] || 0) + 1;
            } else if (pdfContent === '📗') { // Annotated PDF present
                counts['pdf_annotated'] = (counts['pdf_annotated'] || 0) + 1;
                counts['pdf_present'] = (counts['pdf_present'] || 0) + 1;       // Also count annotated as a PDF present
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
        }
    });

    // Make counts available outside this function
    latestCounts = counts;
    latestYearlyData = {
        surveyImpl: yearlySurveyImpl,
        pubTypes: yearlyPubTypes,
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
    // Sort and filter results (count >= 1)
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
    const defaults = Chart.defaults.plugins.legend.labels.generateLabels;
    const labels = defaults.call(this, chart);   // keep default click behaviour
    if (!isCumulative) return labels;                // nothing to do
    labels.forEach(lbl => {
        const ds = chart.data.datasets[lbl.datasetIndex];
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
                    // //console.log(`Unrecognized type for ${journalConfName}: ${typeValue}`);
                    // You could add them to a 'miscellaneous' category if desired
                }
            }
        }
        // --- Get data from hidden cells ---
        // Find the hidden cells by their data-field attribute within the current row
        const keywordsCell = row.querySelector('td[data-field="keywords"]');
        const authorsCell = row.querySelector('td[data-field="authors"]');
        const researchAreaCell = row.querySelector('td[data-field="research_area"]');

        // --- Extract and Process Keywords ---
        if (keywordsCell) { // Check if the cell exists before accessing its content
            const keywordsText = keywordsCell.textContent.trim();
            if (keywordsText) {
                const keywordsList = keywordsText.split(';')
                    .map(kw => kw.trim())
                    .filter(kw => kw.length > 0);
                keywordsList.forEach(keyword => {
                    stats.keywords[keyword] = (stats.keywords[keyword] || 0) + 1;
                });
            }
        }

        // --- Extract and Process Authors ---
        if (authorsCell) { // Check if the cell exists before accessing its content
            const authorsText = authorsCell.textContent.trim();
            if (authorsText) {
                const authorsList = authorsText.split(';')
                    .map(author => author.trim())
                    .filter(author => author.length > 0);
                authorsList.forEach(author => {
                    stats.authors[author] = (stats.authors[author] || 0) + 1;
                });
            }
        }

        // --- Extract and Process Research Area ---
        if (researchAreaCell) { // Check if the cell exists before accessing its content
            const researchAreaText = researchAreaCell.textContent.trim();
            if (researchAreaText) {
                stats.researchAreas[researchAreaText] = (stats.researchAreas[researchAreaText] || 0) + 1;
            }
        }
    });

    function populateList(listElementId, dataObj) {
        const listElement = document.getElementById(listElementId);
        if (!listElement) {
            console.warn(`List element with ID ${listElementId} not found.`);
            return;
        }
        listElement.innerHTML = '';
        const sortedEntries = Object.entries(dataObj)
            .filter(([name, count]) => count >= 2) // Keep only entries with count >= 1 (changed from > 1 if desired)
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
    populateList('keywordStatsList', stats.keywords);
    populateList('authorStatsList', stats.authors);
    populateList('researchAreaStatsList', stats.researchAreas);

    // ---- now the lists exist; build cloud if switch is on ----
    if (document.getElementById('cloudToggle').checked) {
        toggleCloud();                     // first render
    }
}

function prepareScopeData(totalVisiblePaperCount, totalAllPaperCount) {
    let ontopicCount = 0;
    let offtopicCount = 0;

    if (document.body.id === 'html-export') {
        const allRowsInExport = document.querySelectorAll('#papersTable tbody tr[data-paper-id]');
        const totalRowsInExportLoaded = allRowsInExport.length;
        ontopicCount = totalVisiblePaperCount;
        offtopicCount = Math.max(0, totalRowsInExportLoaded - totalVisiblePaperCount);
    } else {
        ontopicCount = totalVisiblePaperCount;
        offtopicCount = Math.max(0, totalAllPaperCount - totalVisiblePaperCount); // Ensure non-negative
    }

    //console.log(`[prepareScopeData] Document ID: ${document.body.id}, Total Loaded (Export) / Total DB (Main): ${document.body.id === 'html-export' ? document.querySelectorAll('#papersTable tbody tr[data-paper-id]').length : totalAllPaperCount}, Visible (On-topic): ${ontopicCount}, Calculated Off-topic: ${offtopicCount}`); // Debug log

    return {
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
}

function prepareSurveyVsImplDistData(totalVisiblePaperCount) {
    // Use the correct counts from latestCounts and total visible papers
    const surveyCount = latestCounts['is_survey'] || 0;
    // Calculate implementation count: total visible - survey count
    const implCount = totalVisiblePaperCount - surveyCount;
    return {
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
}

function preparePubTypesDistData() {
    // Get unique types that actually appear in the *currently visible* data (from latestYearlyData.pubTypes)
    // This replicates the original logic more closely.
    const allPubTypesSet = new Set();
    // Iterate through the yearly data collected for *visible* rows
    Object.values(latestYearlyData.pubTypes || {}).forEach(yearData => {
        // Add the raw type keys (e.g., 'article', 'inproceedings') found in the data to the set
        Object.keys(yearData).forEach(rawType => allPubTypesSet.add(rawType));
    });
    // Convert the set to an array of *actual* types present
    const allPubTypes = Array.from(allPubTypesSet).sort(); // Sort for consistent order

    // Calculate the total count for each *actual* type found above
    const pubTypesDistData = allPubTypes.map(rawType => {
        let count = 0;
        // Sum the counts for this raw type across all years in the collected data
        Object.values(latestYearlyData.pubTypes || {}).forEach(yearData => {
            count += yearData[rawType] || 0;
        });
        return count;
    });

    // Translate the *actual* raw type names into the user-friendly labels using the map
    const pubTypesDistLabels = allPubTypes.map(rawType => mapPubType(rawType));

    // Generate colors dynamically based on the index of the *actual* types found (not the full map)
    const pubTypesDistColors = allPubTypes.map((rawType, index) => {
        const hue = (index * 137.508) % 360; // Golden angle approximation for spread
        return `hsla(${hue}, 30%, 65%, 0.85)`; // Slightly transparent for contrast
    });

    return {
        labels: pubTypesDistLabels, // Use the translated labels for the *actual* types
        datasets: [{
            label: 'Publication Types Distribution',
            data: pubTypesDistData, // Use the counts for the *actual* types
            backgroundColor: pubTypesDistColors, // Use colors for the *actual* types
            borderColor: "#333",
            borderWidth: 1,
            hoverOffset: 4
        }]
    };
}

function prepareRelevanceHistogramData(visibleRows) {
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
    return {
        labels: Array.from({ length: 11 }, (_, i) => i.toString()), // Labels "0", "1", ..., "10"
        datasets: [{
            label: 'Relevance Histogram',
            data: relevanceCounts,
            backgroundColor: 'hsla(204, 62%, 57%, 0.95)', // Blue (from techniques)
            borderColor: 'hsla(204, 82%, 28%, 0.75)', // Darker Blue border
            borderWidth: 1
        }]
    };
}

// --- Refactored Chart Rendering Functions ---
function destroyExistingCharts() {
    const chartInstances = [
        'surveyVsImplLineChartInstance', 
        'pubTypesPerYearLineChartInstance',
        'surveyVsImplDistChartInstance', 
        'pubTypesDistChartInstance',
        'scopeDistChartInstance',
        'relevanceHistogramInstance'
    ];
    chartInstances.forEach(instanceName => {
        if (window[instanceName]) {
            window[instanceName].destroy();
            delete window[instanceName];
        }
    });
}

// Helper function to determine label position based on bar value
function getBarLabelPosition(value, maxBarValue) {
    const halfMax = maxBarValue / 2;
    if (value < halfMax) {
        return { align: 'end', anchor: 'end' }; // Inside the bar at the end (right side for horizontal bars)
    } else {
        return { align: 'start', anchor: 'end' }; // Outside the bar at the end (right side for horizontal bars)
    }
}
function renderBarOrPieChart(ctx, chartData, chartLabel, chartType) {
    const isBar = chartType === 'bar';
    let datalabelsPluginConfig = {};
    let datalabelsPlugin = [];

    /* -------------------------------------------------
       1.  HORIZONTAL BAR – keep the old “smart” labels
       ------------------------------------------------- */

    if (isBar && ChartDataLabels) {
        // Calculate the maximum value across all datasets for this chart
        let maxBarValue = 0;
        if (chartData.datasets && chartData.datasets.length > 0) {
            chartData.datasets.forEach(dataset => {
                if (dataset.data && Array.isArray(dataset.data)) {
                    const datasetMax = Math.max(...dataset.data.map(v => Math.abs(v))); // Use abs in case of negative values
                    if (datasetMax > maxBarValue) {
                        maxBarValue = datasetMax;
                    }
                }
            });
        }

        datalabelsPluginConfig = {
            datalabels: {
                // Use a formatter function to return the value or an empty string if 0
                formatter: value => value > 0 ? value : '',
                color: '#444',
                font: { size: 11, weight: '400' },
                anchor: function(context) {
                    // Determine anchor based on value and maxBarValue
                    const value = context.dataset.data[context.dataIndex];
                    return getBarLabelPosition(value, maxBarValue).anchor;
                },
                align: function(context) {
                    // Determine align based on value and maxBarValue
                    const value = context.dataset.data[context.dataIndex];
                    return getBarLabelPosition(value, maxBarValue).align;
                },
                offset: 4 // Consistent offset for both inside and outside
            }
        };
        datalabelsPlugin = [ChartDataLabels];
    }

    /* -------------------------------------------------
       2.  PIE – show percentage inside every slice
       ------------------------------------------------- */
       //known issue: the percentages are right only when all slices are enabled!
    if (!isBar && ChartDataLabels) {
        datalabelsPluginConfig = {
            datalabels: {
                color: '#444',
                font: ctx => {                       // ← dynamic font
                    const h = ctx.chart.width || 280; // fallback
                    return {
                        size: Math.max(10, h * 0.035), // 10 px minimum
                        weight: '300'
                    };
                },
                anchor: 'end',
                align: 'start',
                offset: -2,
                formatter: (value, ctx) => {
                    const sum = ctx.dataset.data.reduce((a, b) => a + b, 0);
                    const pct = sum ? Math.round((value / sum) * 100) : 0;
                    return pct > 3  ? pct + '%' : '';
                }
            }
        };
        datalabelsPlugin = [ChartDataLabels];
    }

    /* -------------------------------------------------
       3.  Common Chart.js config
       ------------------------------------------------- */
    const options = {
        type: chartType,
        data: chartData,
        options: {
            ...(isBar ? { indexAxis: 'y' } : { radius: '90%' }),
            responsive: true,
            maintainAspectRatio: false,
            devicePixelRatio: getChartDPR(),
            plugins: {
                legend: {
                    display: !isBar,
                    position: 'top',
                    labels: { usePointStyle: true, pointStyle: 'circle' }
                },
                title: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => `${ctx.label}: ${ctx.raw}`
                    }
                },
                ...datalabelsPluginConfig
            },
            scales: {
                ...(isBar ? { x: { beginAtZero: true, ticks: { precision: 0 } } } : {})
            }
        },
        plugins: datalabelsPlugin
    };

    return new Chart(ctx, options);
}


function renderHistogram(ctx, chartData, title) {
    const options = {
        type: 'bar',
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            devicePixelRatio: getChartDPR(),
            plugins: {
                legend: { display: false },
                title: { display: false, text: title }
            },
            scales: {
                x: {
                    title: {
                        display: false,
                        text: title.split(' ')[0] // Use first word as axis label (Relevance/Estimated)
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
    return new Chart(ctx, options);
}

function renderLineCharts() {
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

    const surveyVsImplCtx = document.getElementById('surveyVsImplLineChart')?.getContext('2d');
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
            devicePixelRatio: getChartDPR(),
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

    // --- 4. Publication Types per Year (Translated Labels) ---
    const pubTypesYearlyData = latestYearlyData.pubTypes || {};
    const yearsForPubTypes = Object.keys(pubTypesYearlyData).map(Number).sort((a, b) => a - b);
    // Create datasets for the line chart, one for each publication type
    const allPubTypes = Object.keys(PUB_TYPE_MAP); // Or get from yearly data if needed
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
    const pubTypesPerYearCtx = document.getElementById('pubTypesPerYearLineChart')?.getContext('2d'); // Get context for pub types chart
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
                devicePixelRatio: getChartDPR(),
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
                devicePixelRatio: getChartDPR(),
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: 'Publication Types per Year (No Data)' }
                }
            }
        });
    }
    // This ensures datasets are reordered for stacking *after* they are rendered,
    // whether the render was due to initial display, stacking toggle, or cumulative toggle.
    reorderDatasetsForStacking();
}


// --- Refactored displayStats function ---
function displayStats() {
    document.documentElement.classList.add('busyCursor');
    
    setTimeout(() => {
        updateCounts(); // Run updateCounts to get the latest data for visible rows

        // --- Read Counts and Paper Counts ---
        // Get the total number of currently visible papers directly
        const visibleRows = document.querySelectorAll('#papersTable tbody tr[data-paper-id]:not(.filter-hidden)');
        const totalVisiblePaperCount = visibleRows.length;
        // Get the total number of *all* papers from the footer cell
        const totalPaperCountCell = document.getElementById('total-papers-count');
        const totalAllPaperCount = totalPaperCountCell ? parseInt(totalPaperCountCell.textContent.trim(), 10) : 0;

        // --- Destroy existing charts if they exist (important for re-renders) ---
        destroyExistingCharts();

        // --- Prepare and Render Charts ---
        Chart.defaults.font = {
            size: 12.5,
            family: 'Arial Narrow',
            weight: '300'
        };

        const surveyVsImplDistCtx = document.getElementById('surveyVsImplPieChart')?.getContext('2d');
        const surveyVsImplDistChartData = prepareSurveyVsImplDistData(totalVisiblePaperCount);
        window.surveyVsImplDistChartInstance = renderBarOrPieChart(surveyVsImplDistCtx, surveyVsImplDistChartData, 'Survey vs Primary Distribution', showPieCharts ? 'pie' : 'bar');

        const pubTypesDistCtx = document.getElementById('publTypePieChart')?.getContext('2d');
        const pubTypesDistChartData = preparePubTypesDistData();
        window.pubTypesDistChartInstance = renderBarOrPieChart(pubTypesDistCtx, pubTypesDistChartData, 'Publication Types Distribution', showPieCharts ? 'pie' : 'bar');

        const scopeCtx = document.getElementById('OffTopicPieChart')?.getContext('2d');
        const scopeChartData = prepareScopeData(totalVisiblePaperCount, totalAllPaperCount);
        window.scopeDistChartInstance = renderBarOrPieChart(scopeCtx, scopeChartData, 'Dataset Scope (On-topic vs Off-topic)', showPieCharts ? 'pie' : 'bar');

        // --- Histogram Charts ---
        const relevanceHistogramCtx = document.getElementById('RelevanceHistogram')?.getContext('2d');
        const relevanceHistogramData = prepareRelevanceHistogramData(visibleRows);
        window.relevanceHistogramInstance = renderHistogram(relevanceHistogramCtx, relevanceHistogramData, 'Relevance Histogram');

        // --- Line Charts ---
        renderLineCharts();

        // --- Populate Client-side Journal/Conference Lists ---
        const { journals, conferences } = calculateJournalConferenceStats();

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
                searchButton.addEventListener('click', function (event) {
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
            // Append rows to the table
            tableElement.appendChild(createRow('Total <strong>filtered</strong> articles:', totalVisiblePaperCount));
            tableElement.appendChild(createRow('Total unique <strong>journals</strong>:', distinctJournalsCount));
            tableElement.appendChild(createRow('Total unique <strong>conferences</strong>:', distinctConferencesCount));
            tableElement.appendChild(createRow('Total unique <strong>authors</strong>:', distinctAuthorsCount));
        }

        populateMetricsTableDirectly();
        setTimeout(() => {
            // Trigger reflow to ensure styles are applied before adding the active class
            // This helps ensure the transition plays correctly on the first open
            modal.offsetHeight;
            // Add the active class to trigger the animation
            modal.classList.add('modal-active');
            document.documentElement.classList.remove('busyCursor');
        }, 250);
    }, 0);
}

function displayAbout() {
    modalSmall.offsetHeight;
    modalSmall.classList.add('modal-active');
}

function closeSmallModal() { modalSmall.classList.remove('modal-active'); }

function closeModal() { modal.classList.remove('modal-active'); } //for stats modal:
const cloudColors = [
    'hsla(347, 70%, 39%, 0.75)',
    'hsla(204, 82%, 28%, 0.75)',
    'hsla(42, 100%, 28%, 0.75)',
    'hsla(180, 48%, 28%, 0.75)',
    'hsla(260, 100%, 40%, 0.75)',
    'hsla(30, 100%, 33%, 0.75)',
    'hsla(0, 0%, 38%, 0.75)',
    'hsla(147, 48%, 38%, 0.75)',
];
function buildKeywordCloud() {
  /* ----------  collect & normalise data  ---------- */
  const liNodes = document.querySelectorAll('#keywordStatsList li');
  const raw = Array.from(liNodes)
    .map(li => {
      const nameEl = li.querySelector('.name');
      const countEl = li.querySelector('.count');
      if (!nameEl || !countEl) return null;
      return { text: nameEl.textContent.trim(), size: +countEl.textContent };
    })
    .filter(Boolean);

  if (!raw.length) {                       // empty list → wipe previous SVG
    const prevSvg = document.querySelector('#keywordCloudCanvas svg');
    if (prevSvg) prevSvg.remove();
    return;
  }

  const topK = raw.slice(0, 50);

  /* ----------  dimensions  ---------- */
  const width = document.querySelector('#keywordCloudCanvas').clientWidth || 500;
  const height = 280;

  /* ----------  font scale  ---------- */
  const sizeScale = d3.scaleLinear()
    .domain([topK[topK.length - 1].size, topK[0].size])
    .range([9 , 54]);

  /* ----------  layout (unchanged)  ---------- */
  const layout = d3.layout.cloud()
    .size([width, height])
    .words(topK.map(d => ({ ...d, size: sizeScale(d.size) })))
    .padding(1)
    .rotate(() => (Math.random() - 0.5) * 0)   // 0° for all words
    .font('sans-serif')
    .fontSize(d => d.size)
    .on('end', draw);

  layout.start();

  /* ----------  SVG rendering (like the example)  ---------- */
  function draw(words) {
    /* remove previous cloud if any */
    d3.select('#keywordCloudCanvas').select('svg').remove();

    const svg = d3.select('#keywordCloudCanvas')
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    svg.append('g')
      .attr('transform', `translate(${width / 2},${height / 2})`)
      .selectAll('text')
      .data(words)
      .enter().append('text')
      .style('font-size', d => `${d.size}px`)
      .style('font-family', 'sans-serif')
      .style('fill', d =>
        cloudColors[d.text.length % cloudColors.length])
      .attr('text-anchor', 'middle')
      .attr('transform', d => `translate(${d.x},${d.y})rotate(${d.rotate})`)
      .text(d => d.text);
  }
}

function toggleCloud() {
    const list = document.getElementById('keywordStatsList');
    const canvas = document.getElementById('keywordCloudCanvas');
    const on = document.getElementById('cloudToggle').checked;
    list.style.display = on ? 'none' : 'block';
    canvas.style.display = on ? 'block' : 'none';
    if (!on) return; // ← don’t build if turning off
    const liNodes = list.querySelectorAll('li');
    if (liNodes.length === 0) return; // ← don’t build if no keywords
    buildKeywordCloud(); // ← safe to build
}

function prepareLineChartData() {
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

    const surveyVsImplDatasets = [
        {
            label: 'Survey Papers',
            data: surveyCountsFinal,
            borderColor: 'hsl(204, 42%, 37%)',
            backgroundColor: 'hsla(204, 42%, 67%, 0.95)',
            fill: isStacked,
            tension: 0.25
        },
        {
            label: 'Primary Papers',
            data: implCountsFinal,
            borderColor: 'hsla(38, 70%, 49%, 1.00)',
            backgroundColor: 'hsla(42, 50%, 69%, 0.95)',
            fill: isStacked,
            tension: 0.25
        }
    ];

    const pubTypesYearlyData = latestYearlyData.pubTypes || {};
    const yearsForPubTypes = Object.keys(pubTypesYearlyData).map(Number).sort((a, b) => a - b);
    const pubTypeLineDatasets = Object.keys(PUB_TYPE_MAP).map((type, index) => {
        const hue = (index * 137.508) % 360;
        const borderColor = `hsl(${hue}, 40%, 40%)`;
        const backgroundColor = `hsla(${hue}, 30%, 65%, 0.85)`;
        let data = yearsForPubTypes.map(year => pubTypesYearlyData[year]?.[type] || 0);
        if (isCumulative) {
            data = calculateCumulativeData(data);
        }
        return {
            label: mapPubType(type),
            data: data,
            borderColor: borderColor,
            backgroundColor: backgroundColor,
            fill: isStacked,
            tension: 0.25,
            hidden: false // Consider preserving hidden state if needed
        };
    });

    return {
        surveyImpl: { labels: yearsForSurveyImpl, datasets: surveyVsImplDatasets },
        pubTypes: { labels: yearsForPubTypes, datasets: pubTypeLineDatasets }
    };
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

    stackingToggle.addEventListener('change', function () {
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

    cumulativeToggle.addEventListener('change', function () {
        isCumulative = this.checked; // Update the state variable

        // Prepare the updated data based on the new cumulative state
        const updatedLineChartData = prepareLineChartData();

        // Update each line chart instance with the new data
        if (window.surveyVsImplLineChartInstance) {
            window.surveyVsImplLineChartInstance.data.labels = updatedLineChartData.surveyImpl.labels;
            window.surveyVsImplLineChartInstance.data.datasets = updatedLineChartData.surveyImpl.datasets;
            // No need to update scales for cumulative, just data and potentially legend
            // Legend update might be handled by cumulativeLegendLabels already, but update() triggers it
            window.surveyVsImplLineChartInstance.update(); // Update the chart
        }
        if (window.pubTypesPerYearLineChartInstance) {
            window.pubTypesPerYearLineChartInstance.data.labels = updatedLineChartData.pubTypes.labels;
            window.pubTypesPerYearLineChartInstance.data.datasets = updatedLineChartData.pubTypes.datasets;
            window.pubTypesPerYearLineChartInstance.update();
        }
        // reorderDatasetsForStacking(); // Call this *after* updating data if stacking is enabled and cumulative changed
        if (isStacked) {
            reorderDatasetsForStacking();
        }
    });
    
    pieToggle.addEventListener('change', function () {
        showPieCharts = this.checked; // Update the state variable

        // Prepare the updated data based on the new showPieCharts state
        const surveyVsImplDistChartData = prepareSurveyVsImplDistData(
            // You need to get the current totalVisiblePaperCount here.
            // It's calculated in displayStats but not stored globally.
            // Option 1: Store it in a global variable like latestCounts/YearlyData
            // Option 2: Recalculate it here (less efficient but simpler for this change)
            document.querySelectorAll('#papersTable tbody tr[data-paper-id]:not(.filter-hidden)').length
        );
        const pubTypesDistChartData = preparePubTypesDistData();
        const scopeChartData = prepareScopeData(
            // Similarly, you need the visible and total counts here
            document.querySelectorAll('#papersTable tbody tr[data-paper-id]:not(.filter-hidden)').length,
            parseInt(document.getElementById('total-papers-count')?.textContent.trim() || '0', 10)
        );

        // Determine the chart type ('bar' or 'pie')
        const chartType = showPieCharts ? 'pie' : 'bar';

        // Survey vs Impl Distribution Chart
        if (window.surveyVsImplDistChartInstance) {
            window.surveyVsImplDistChartInstance.destroy();
            const surveyVsImplDistCtx = document.getElementById('surveyVsImplPieChart')?.getContext('2d');
            if (surveyVsImplDistCtx) {
                window.surveyVsImplDistChartInstance = renderBarOrPieChart(surveyVsImplDistCtx, surveyVsImplDistChartData, 'Survey vs Primary Distribution', chartType);
            }
        }

        // Publication Types Distribution Chart
        if (window.pubTypesDistChartInstance) {
            window.pubTypesDistChartInstance.destroy();
            const pubTypesDistCtx = document.getElementById('publTypePieChart')?.getContext('2d');
            if (pubTypesDistCtx) {
                window.pubTypesDistChartInstance = renderBarOrPieChart(pubTypesDistCtx, pubTypesDistChartData, 'Publication Types Distribution', chartType);
            }
        }

        // Scope Distribution Chart
        if (window.scopeDistChartInstance) {
            window.scopeDistChartInstance.destroy();
            const scopeCtx = document.getElementById('OffTopicPieChart')?.getContext('2d');
            if (scopeCtx) {
                window.scopeDistChartInstance = renderBarOrPieChart(scopeCtx, scopeChartData, 'Dataset Scope (On-topic vs Off-topic)', chartType);
            }
        }
        // Note: Line charts (window.surveyVsImplLineChartInstance, etc.) are NOT touched here.
    });

    aboutBtn.addEventListener('click', displayAbout);

    // --- Close Modal
    spanClose.addEventListener('click', closeModal);
    smallClose.addEventListener('click', closeSmallModal);

    // --- Add F4 shortcut ---
    document.addEventListener('keydown', function (event) {
        // Check if the pressed key is 'Escape' and if the modal is currently active
        if (event.key === 'Escape') {
            closeModal();
            closeSmallModal();
            if (document.body.id !== "html-export") {
                // Assuming these functions exist in the global scope or are imported
                closeBatchModal(); /* from comms.js */
                closeExporthModal();
                closeImportModal()
            }
        }
        // Add the F4 key check for opening the stats panel
        if (event.key === 'F4') {
            event.preventDefault(); // Prevent any default F4 behavior (though browsers often don't have one)
            document.documentElement.classList.add('busyCursor');
            closeSmallModal();
            if (document.body.id !== "html-export") {
                // Assuming these functions exist in the global scope or are imported
                closeBatchModal(); /* from comms.js */
                closeExporthModal();
                closeImportModal()
            }
            buildStatsLists(); // Ensure lists are built before displaying
            displayStats();
        }
    });

    cloudToggle.addEventListener('change', toggleCloud);
    cloudToggle.checked = true;          // 1. UI match

    window.addEventListener('click', function (event) {
        if (event.target === modal || event.target === modalSmall) {
            closeModal();
            closeSmallModal();
        }
        if (document.body.id !== 'html-export') {
            if (event.target === batchModal || event.target === importModal || event.target === exportModal) {
                closeBatchModal(); /* from comms.js */
                closeImportModal();
                closeExporthModal();
            }
        }
    });
});