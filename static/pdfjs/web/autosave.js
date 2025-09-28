document.addEventListener('DOMContentLoaded', function () {
    const PDFViewerApplication = window.PDFViewerApplication;
    if (!PDFViewerApplication) {
        console.error("PDFViewerApplication is not available.");
        return;
    }

    // --- 1. Get the paper_id from the URL ---
    const urlParams = new URLSearchParams(window.location.search);
    const fileUrl = urlParams.get('file');
    let paperId = '';
    if (fileUrl) {
        // The URL is now /serve_pdf/paper_id
        paperId = decodeURIComponent(fileUrl.split('/').pop());
    }

    if (!paperId) {
        console.error("Could not determine the paper_id from the URL.");
        return;
    }

    // --- 2. Debounce function ---
    function debounce(func, delay) {
        let timeoutId;
        return function (...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func.apply(this, args), delay);
        };
    }

    // --- 3. Function to save and upload the annotated PDF ---
    async function saveAndUploadPdf() {
        try {
            // This is the core PDF.js function to get the modified file data [13-15]
            const updatedPdfData = await PDFViewerApplication.pdfDocument.saveDocument();
            const blob = new Blob([updatedPdfData], { type: 'application/pdf' });
            const formData = new FormData();
            formData.append('pdf_file', blob, "annotated.pdf");

            // Construct the NEW server route using the paper_id
            const uploadUrl = `/upload_annotated_pdf/${encodeURIComponent(paperId)}`;
            
            // --- 4. Send the file to the new server route ---
            const response = await fetch(uploadUrl, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                throw new Error(`Server responded with status: ${response.status}`);
            }
            const result = await response.json();
            if (result.status === 'success') {
                console.log('Auto-save successful:', result.message);
            } else {
                console.error('Auto-save failed:', result.message);
            }
        } catch (error) {
            console.error('An error occurred during auto-save:', error);
        }
    }

    // --- 5. Create debounced version of the save function ---
    const debouncedSaveAndUploadPdf = debounce(saveAndUploadPdf, 5000); // 5 seconds

    // --- 6. Listen for annotation events to trigger the debounced auto-save ---
    // 'annotationeditorstateschanged' is a robust event for this purpose [16]
    PDFViewerApplication.eventBus.on('annotationeditorstateschanged', (evt) => {
        if (evt.details.isEditing) {
            console.log('Annotation change detected, triggering debounced auto-save.');
            debouncedSaveAndUploadPdf();
        }
    });

    console.log(`Auto-save script initialized for paper_id: ${paperId}.`);
});