# ResearchParça-Lite

Minimal, generalized (not domain-specific), open source (permissive Apache 2.0 license) Lite version of ResearchParça. Also check the [full version repository](https://github.com/Zidrewndacht/bibtex-custom-parser).

Automatic classification/verification functionality is stripped out (as the classifier would require domain-specific tables, etc.), but frontend goodies are kept:

Autosaving PDF Annotator;
Primary vs Survey filtering;
Sortable table columns;
Searchable abstracts, keywords, authors, user comments;
Full backup/restore (original+annotated PDFs and DB with comments);
BibTeX imports, HTML/XLSX exports
(Some) Dynamic statistics;

In other words, this version is a glorified PDF annotator with some statistics charts. This was made mostly to allow generic usage of the autosaving annotator, but it was easier to strip ResearchParça functionality than build a new UI just for that.

**Note:** *ResearchParça* is the correct name. The repository name is set as *ResearchParsa* due to GitHub limitations (no ç support, and c wouldn't sound as correct).

## Usage

0.  **Running the Application**:
    - Ensure Python 3.x is installed.
    - Download this repository and run !browse_db.bat. A Virtual Environment with the according requirements will be automatically created if it doesn't yet exist. After startup, the application will be available at `http://127.0.0.1:5001`, and a browser window should open to this address automatically.
    - Albeit untested, this should run fine in Linux or Mac, you just have to manually create and run the venv in that case.
    - Look at the help page in the Web application itself for more instructions about the Web interface itself (Note: those instructions are currently outdated, some functionality has been changed or added).

2.  **Database Setup**:
    - You can import a BibTeX file directly from the web interface after the application is running. If no database is found on startup, the application will copy `fallback.sqlite` to the data directory to ensure it can launch for the first import or a backup restore.
      
