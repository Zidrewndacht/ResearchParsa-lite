// static/ghpages.js
// This should eventually be refactored to use globals.js and only keep here 
// the logic exclusive to the client-side-only standalone HTML/GHpages version

const minPageCountInput = document.getElementById('min-page-count');
const yearFromInput = document.getElementById('year-from');
const yearToInput = document.getElementById('year-to');

const allRows = document.querySelectorAll('#papersTable tbody tr[data-paper-id]');
const totalPaperCount = allRows.length;


function toggleDetails(element) {   //this function is specific to GH Export! Same name function is different in comms.js for the server-based version.
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

function fetchDetailRowLists() {    //this function is specific to GH Export! Same name function is different in comms.js for the server-based version.
    const stats = {
        journals: {}, // Will store journal names and counts
        conferences: {}, // NEW: Will store conference names and counts
        keywords: {},
        authors: {},
        researchAreas: {},
        otherDetectedFeatures: {},
        modelNames: {}
    };
    const visibleRows = document.querySelectorAll('#papersTable tbody tr[data-paper-id]:not(.filter-hidden)');
    visibleRows.forEach(row => {
        // --- Get Journal/Conference and Type ---
        const journalCell = row.cells[journalCellIndex]; // Index 4 (Journal/Conf column)
        const typeCell = row.cells[typeCellIndex]; // Index 5 (Type column)

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

        // --- Existing Logic for Keywords, Authors, etc. ---
        // (Keep the rest of the loop body unchanged)
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
            const modelNameInput = detailRowForModelName.querySelector('.detail-edit input[name="model_name"]'); // Adjust selector if necessary
            if (modelNameInput) {
                const modelNameText = modelNameInput.value.trim();
                if (modelNameText) {
                    // Split by comma or semicolon, trim whitespace, filter out empty strings
                    const modelNamesList = modelNameText.split(/[,;]/).map(m => m.trim()).filter(m => m.length > 0);
                    modelNamesList.forEach(modelName => {
                        // Count occurrences of each individual model name string
                        stats.modelNames[modelName] = (stats.modelNames[modelName] || 0) + 1; // Fixed: Added space around ||
                    });
                }
            }
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
            .filter(([name, count]) => count > 1) // Keep only entries with count > 1
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
            // Escape HTML to prevent XSS if data contains special characters
            const escapedName = name.replace(/&/g, "&amp;").replace(/</g, "<").replace(/>/g, ">");
            const escapedNameForTitle = escapedName.replace(/"/g, "&quot;"); // Escape quotes for title attribute

            // Create the list item content with count, search button, and name
            listItem.innerHTML = `<span class="count">${count}</span><button type="button" class="search-item-btn" title="Search for &quot;${escapedNameForTitle}&quot;">🔍</button><span class="name">${escapedName}</span>`;

            listElement.appendChild(listItem);
        });

        // Add event listeners to the newly created search buttons
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
    // --- New Function Call to Populate Lists with Search Buttons ---
    // Function to populate lists where items *can* appear only once (no > 1 filter)
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

        // Add event listeners to the newly created search buttons
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

    // Populate the new lists using the new helper functions
    // Populate Journals (only items with type 'article')
    // populateList('journalStatsList', stats.journals); // Uses stats.journals object
    // Populate Conferences (only items with type 'inproceedings', 'proceedings', 'conference')
    // populateList('conferenceStatsList', stats.conferences); // NEW: Uses stats.conferences object
    populateList('keywordStatsList', stats.keywords);
    populateList('authorStatsList', stats.authors);
    populateList('researchAreaStatsList', stats.researchAreas);

    populateSimpleList('otherDetectedFeaturesStatsList', stats.otherDetectedFeatures);
    populateSimpleList('modelNamesStatsList', stats.modelNames);

    // Trigger reflow and add modal-active class after charts are drawn and lists are populated
    modal.offsetHeight; // Trigger reflow
    modal.classList.add('modal-active');
    // return stats;
}


document.addEventListener('DOMContentLoaded', function () {
    //These listeners are specific to GH Export:
    searchInput.addEventListener('input', applyLocalFilters);           //client-side search
    hideOfftopicCheckbox.addEventListener('change', applyLocalFilters);
    minPageCountInput.addEventListener('input', applyLocalFilters);
    minPageCountInput.addEventListener('change', applyLocalFilters);

    yearFromInput.addEventListener('input', applyLocalFilters);
    yearFromInput.addEventListener('change', applyLocalFilters);
    yearToInput.addEventListener('input', applyLocalFilters);
    yearToInput.addEventListener('change', applyLocalFilters);
});

