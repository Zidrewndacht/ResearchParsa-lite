//globals.js
const batchModal = document.getElementById("batchModal");
const importModal = document.getElementById("importModal");
const exportModal = document.getElementById("exportModal");

//Checkboxes:  

const minPageCountInput = document.getElementById('min-page-count');
const yearFromInput = document.getElementById('year-from');
const yearToInput = document.getElementById('year-to');
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

//for stats modal:
function closeModal() { modal.classList.remove('modal-active'); }



document.addEventListener('DOMContentLoaded', function () {
    aboutBtn.addEventListener('click', displayAbout);
    // --- Close Modal
    spanClose.addEventListener('click', closeModal);
    smallClose.addEventListener('click', closeSmallModal);
    document.addEventListener('keydown', function (event) {
        // Check if the pressed key is 'Escape' and if the modal is currently active
        if (event.key === 'Escape') { closeModal(); closeSmallModal(); closeBatchModal(); closeExporthModal(); closeImportModal() }
    });
    window.addEventListener('click', function (event) {
        if (event.target === modal || event.target === modalSmall || event.target === batchModal || event.target === importModal || event.target === exportModal) 
            { closeModal(); closeSmallModal(); closeBatchModal(); closeExporthModal(); closeImportModal()  }
    });
})