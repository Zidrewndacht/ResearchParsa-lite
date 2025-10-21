# ResearchParça

Live Demo (read-only HTML export): [ResearchParça](https://zidrewndacht.github.io/bibtex-custom-parser).

The frontend was mostly tested with Mozilla Firefox and works well. The HTML export has some **known performance issues in Chromium-based browsers**. If the page lags, stops responding, etc, in reasonably modern hardware, please run it in Firefox instead.

ResearchParça is a tool for managing and analyzing a bibliographic database, specifically tailored for academic papers on Printed Circuit Board (PCB) inspection. It processes BibTeX files, stores the data in an SQLite database, and provides a web interface for browsing, filtering, and editing the information. The core functionality includes using Large Language Models (LLMs) to automatically classify papers based on their content (title, abstract, keywords) and to verify these classifications.

The system is designed to streamline literature reviews by allowing for advanced search capabilities, statistical analysis of the dataset, and traceable, LLM-driven data enrichment.

https://github.com/user-attachments/assets/a37ee7b6-27e8-459a-a092-be67ee769b5e

https://github.com/user-attachments/assets/3a12f927-1050-485e-b6f7-5df151685a58

## Features

- **BibTeX Import**: Imports bibliographic data from `.bib` files into a structured SQLite database. The import process handles duplicate entries by checking for existing DOIs or matching titles and years.
- **Web Interface**: A Flask-based web application (`browse_db.py`) provides a user-friendly interface to view, filter, and edit the paper database. The server starts up and automatically opens the interface in a web browser.
- **LLM-Powered Classification**: The `automate_classification.py` script sends paper metadata to an OpenAI-compatible LLM server (e.g. llama.cpp) to classify papers based on a detailed prompt template. It can process all papers, only unprocessed ones, or a single paper by its ID. Classification results, **including the model's reasoning trace**, are saved to the database.
- **LLM-Powered Verification**: `verify_classification.py` uses an LLM to review and verify the accuracy of a previous classification, providing a score and a "verified" status. This process also runs in different modes ('all', 'remaining', 'id').
- **Advanced Filtering and Search**: The web UI allows for server-side filtering by year range, minimum page count, and off-topic. Every other filtering functionality, including search, is done purely client-side (which means search can NOT find papers outside the currently downloaded range (e.g. year, size, off-topic).
- **Data Editing**: Users can directly edit classification fields, add comments (`user_trace`), and manage metadata through the web interface.
- **PDF Management**: The application supports uploading, storing, and viewing PDF versions of papers. It includes an integrated, branded version of PDF.js that allows for annotating documents directly in the browser, with changes being automatically saved to the server.
- **Data Export**: The currently filtered view of the database can be exported to:
    - A self-contained, interactive static **HTML file**. This export is compressed for a smaller file size and includes client-side filtering and charting capabilities.
    - An **Excel (.xlsx) file**, with boolean fields conditionally formatted for readability, ready to be processed using pivot tables and/or any other Excel tools.
- **Backup and Restore**: The system includes functionality to create a complete backup (`.parça.zst` file) containing the SQLite database, all stored PDFs (original and annotated), and a HTML/XLSX export. The backup file can also be manually extracted and browsed (including annotated PDFs) directly from the included HTML export.

## Usage

0.  **Running the Application**:
    - Ensure Python 3.x is installed.
    - Download this repository and run !browse_db.bat. A Virtual Environment with the according requirements will be automatically created if it doesn't yet exist. After startup, the application will be available at `http://127.0.0.1:5000`, and a browser window should open to this address automatically.
    - This should run fine in Linux or Mac, you just have to manually create and run the venv in that case.
    - Look at the help page in the Web application itself for more instructions about the Web interface itself (Note: those instructions are currently outdated, some functionality has been changed or added).

2.  **Database Setup**:
    - You can import a BibTeX file directly from the web interface after the application is running. If no database is found on startup, the application will copy `fallback.sqlite` to the data directory to ensure it can launch for the first import or a backup restore.
      
3.  **LLM Integration**:
    - Start an OpenAI-compatible inference server (e.g., llama.cpp). `/lcpp` folder has sample settings for a **supported** llama.cpp configuration.
    - From the web UI, you can trigger classification and verification tasks for individual papers or in batches ('all' or 'remaining').
    - Alternatively, manually run classification using `automate_classification.py` and `verify_classification.py`. Manual run supports (not yet properly documented) additional operating modes, check the script's usage hints.

<img width="1995" height="1579" alt="image" src="https://github.com/user-attachments/assets/5591360f-cec9-4b9f-b544-3a063402065f" />
