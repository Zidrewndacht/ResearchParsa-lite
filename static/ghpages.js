// static/ghpages.js
// Logic exclusive to the client-side-only standalone HTML/GHpages version

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

