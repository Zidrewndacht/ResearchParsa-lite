# ResearchParça-Lite

Minimal, generalized (not domain-specific) Lite version of ResearchParça. Also check the [full version repository]().

Automatic classification/verification functionality is stripped out (as the classifier would require domain-specific tables, etc.), but frontend goodies are kept:

Autosaving PDF Annotator;
Primary vs Survey filtering;
Sortable table columns;
Searchable abstracts, keywords, authors, user comments;
Full backup/restore (original+annotated PDFs and DB with comments);
BibTeX imports, HTML/XLSX exports
(Some) Dynamic statistics;

In other words, this version is a glorified PDF annotator with some statistics charts. This was made mostly to allow generic usage of the autosaving annotator, but it was easier to strip ResearchParça functionality than build a new UI just for that.


## Usage

1.  **Installation**:
    - Ensure Python 3.x is installed.
    - Create a virtual environment and install the required packages: `pip install -r requirements.txt`.

2.  **Configuration**:
    - Edit `globals.py` to configure application settings, including the database file path (`DATABASE_FILE`) and the URL for the LLM server (`LLM_SERVER_URL`). The application is designed to work with an OpenAI-compatible API that supports reasoning traces.

3.  **Database Setup**:
    - You can import a BibTeX file directly from the web interface after the application is running. If no database is found on startup, the application will copy `fallback.sqlite` to the data directory to ensure it can launch for the first import or a backup restore.
    - Alternatively, manually run the import script to create and populate the database:
      ```bash
      python import_bibtex.py your_file.bib data/db.sqlite
      ```

4.  **Running the Application**:
    - Launch the web server by running `browse_db.py`. You can optionally provide the path to the database file as a command-line argument.
      ```bash
      python browse_db.py [path/to/your/db.sqlite]
      ```
    - The application will be available at `http://127.0.0.1:5001`, and a browser window should open to this address automatically.
    - Look at the help page in the Web application itself for more instructions about the Web interface itself (Note: these instructions are currently outdated, some functionality is changed or added).