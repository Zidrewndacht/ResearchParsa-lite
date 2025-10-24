// static/ghpages.js
// Logic exclusive to the client-side-only standalone HTML/GHpages version

const minPageCountInput = document.getElementById('min-page-count');
const yearFromInput = document.getElementById('year-from');
const yearToInput = document.getElementById('year-to');

const allRows = document.querySelectorAll('#papersTable tbody tr[data-paper-id]');
const totalPaperCount = allRows.length;

function toggleDetails(element) {
    const row = element.closest('tr');
    const detailRow = row.nextElementSibling;
    const isExpanded = detailRow && detailRow.classList.contains('expanded');
    const paperId = row.getAttribute('data-paper-id');

    if (isExpanded) {
        // Hiding the detail row
        if (detailRow) {
            detailRow.classList.remove('expanded');
            // Remove listener if stored
            const detailContentContainer = detailRow.querySelector('.detail-flex-container');
            if (detailContentContainer && detailContentContainer._clickableItemListener) {
                 detailContentContainer.removeEventListener('click', detailContentContainer._clickableItemListener);
                 detailContentContainer._clickableItemListener = null;
            }
        }
        element.innerHTML = '<span>Show</span>';
        // Remove ID from set and update URL
        openDetailIds.delete(paperId);
        updateUrlWithDetailState(); // Update URL immediately after hiding
        //console.log(`Closed detail for ${paperId}, set now:`, [...openDetailIds]); // Debug log
    } else {
        // Showing the detail row
        if (detailRow) {
            detailRow.classList.add('expanded');
            const detailContentContainer = detailRow.querySelector('.detail-flex-container');
            if (detailContentContainer) {
                 if (detailContentContainer._clickableItemListener) {
                     detailContentContainer.removeEventListener('click', detailContentContainer._clickableItemListener);
                 }
                 const clickableItemListener = function(event) {
                     if (event.target.classList.contains('clickable-item')) {
                         event.preventDefault();
                         const searchTerm = event.target.getAttribute('data-search-term');
                         if (searchTerm) {
                             searchInput.value = searchTerm.trim();
                             applyLocalFilters();
                         }
                     }
                 };
                 detailContentContainer.addEventListener('click', clickableItemListener);
                 detailContentContainer._clickableItemListener = clickableItemListener;
            } else {
                 console.warn("Detail content container not found for paper", paperId);
            }
        }
        element.innerHTML = '<span>Hide</span>';
        // Add ID to set and update URL
        openDetailIds.add(paperId);
        updateUrlWithDetailState(); // Update URL immediately after showing
        //console.log(`Opened detail for ${paperId}, set now:`, [...openDetailIds]); // Debug log
    }
}

document.addEventListener('DOMContentLoaded', function () {
    //These listeners are specific to GH Export:          
    
    //server-side search disabled for now as FTS is broken. Using full-client-side search everyhwere instead:
    // searchInput.addEventListener('input', applyLocalFilters); //now defined in filtering.js
    hideOfftopicCheckbox.addEventListener('change', applyLocalFilters);
    minPageCountInput.addEventListener('input', applyLocalFilters);
    minPageCountInput.addEventListener('change', applyLocalFilters);

    yearFromInput.addEventListener('input', applyLocalFilters);
    yearFromInput.addEventListener('change', applyLocalFilters);
    yearToInput.addEventListener('input', applyLocalFilters);
    yearToInput.addEventListener('change', applyLocalFilters);
});

