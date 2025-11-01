# globals.py
# **** This *has to be updated* when features or techniques change 
# See DEFAULT_FEATURES and DEFAULT_TECHNIQUE below. ****

import sqlite3

import os

DATABASE_FILE = os.path.join(os.getcwd(), 'data', 'db.sqlite')
os.makedirs(os.path.dirname(DATABASE_FILE), exist_ok=True)  # Ensure the directory exists

PDF_STORAGE_DIR = os.path.join(os.getcwd(), 'data', 'pdf')
os.makedirs(PDF_STORAGE_DIR, exist_ok=True) # Ensure the directory exists

ANNOTATED_PDF_STORAGE_DIR = os.path.join(os.getcwd(), 'data', 'pdf_annotated')
os.makedirs(ANNOTATED_PDF_STORAGE_DIR, exist_ok=True)

# --- Define emoji mapping for publication types ---
TYPE_EMOJIS = {
    'article': '📄',        # Page facing up
    'inproceedings': '📚',  # Books (representing conference proceedings)
    'incollection': '📖',   # Open book (representing book chapters/collections)
    'book': '📘',         # Blue book
    'phdthesis': '🎓',      # Graduation cap
    'mastersthesis': '🎓',  # Graduation cap (using the same for simplicity)
    'techreport': '📋',     # Clipboard
    'misc': '📁',           # File folder
}
# Default emoji for unknown types
DEFAULT_TYPE_EMOJI = '📄' # Using article as default

PDF_EMOJIS = {
    'PDF': '📕',        
    'annotated': '📗',
    'paywalled': '💰',
    'none': '❔'
}

def get_paper_by_id(db_path, paper_id):
    """Fetches a single paper's data from the database by its ID."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM papers WHERE id = ?", (paper_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None