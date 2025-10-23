// static/ghpages.js
// Logic exclusive to the client-side-only standalone HTML/GHpages version

const minPageCountInput = document.getElementById('min-page-count');
const yearFromInput = document.getElementById('year-from');
const yearToInput = document.getElementById('year-to');

const allRows = document.querySelectorAll('#papersTable tbody tr[data-paper-id]');
const totalPaperCount = allRows.length;

// --- NEW/OVERWRITTEN toggleDetails function for GH Export ---
function toggleDetails(element) {   //this function is specific to GH Export!
    const row = element.closest('tr');
    const detailRow = row.nextElementSibling; // Get the immediately following detail row
    const isExpanded = detailRow && detailRow.classList.contains('expanded');
    const paperId = row.getAttribute('data-paper-id'); // Get the paper ID from the main row

    if (isExpanded) {
        // Hiding the detail row
        if (detailRow) {
            detailRow.classList.remove('expanded');
            // Remove the specific listener added for this detail row (optional but good practice)
            // We can use the paperId to identify the listener if needed, but simple removal on hide works.
            // Since the listener is on the detail row itself, removing the class hides it,
            // and the listener remains on the container, which is fine.
        }
        element.innerHTML = '<span>Show</span>';
    } else {
        // Showing the detail row
        if (detailRow) {
            detailRow.classList.add('expanded');
            // Ensure the listener is active for this specific detail row now that it's visible
            // We attach the listener to the detail row container itself to scope it.
            // This listener will catch clicks on .clickable-item elements within *this* specific detail row.
            const detailContentContainer = detailRow.querySelector('.detail-flex-container'); // Target the content container within the detail row

            if (detailContentContainer) {
                 // Remove any existing listener from this container to prevent duplicates if toggled multiple times
                 // A simple way is to remove and re-add the event listener.
                 // Store the listener function for removal if it already exists.
                 if (detailContentContainer._clickableItemListener) {
                     detailContentContainer.removeEventListener('click', detailContentContainer._clickableItemListener);
                 }

                 const clickableItemListener = function(event) {
                     // Check if the clicked element is a clickable item within this detail row
                     if (event.target.classList.contains('clickable-item')) {
                         event.preventDefault(); // Prevent any default action if necessary
                         const searchTerm = event.target.getAttribute('data-search-term');
                         const searchField = event.target.getAttribute('data-search-field'); // Optional

                         if (searchTerm) {
                             // Set the search input value
                             searchInput.value = searchTerm.trim();
                             // Close the stats modal if it's open (optional)
                             // closeModal(); // Assuming closeModal is defined elsewhere or not needed here
                             // Apply the filters to update the table
                             applyLocalFilters();
                         }
                     }
                 };

                 // Attach the listener
                 detailContentContainer.addEventListener('click', clickableItemListener);
                 // Store the listener function reference on the container for potential removal
                 detailContentContainer._clickableItemListener = clickableItemListener;

            } else {
                 console.warn("Detail content container not found for paper", paperId);
            }

        }
        element.innerHTML = '<span>Hide</span>';
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

