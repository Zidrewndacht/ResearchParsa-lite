```text
# !browse.bat
@echo off
D:\!staging\BibTeX-custom-parser\.venv\Scripts\python D:\!staging\BibTeX-custom-parser\browse_db.py
pause
```

```text
# !classify_and_verify_remaining.bat
@echo off
D:\!staging\BibTeX-custom-parser\.venv\Scripts\python D:\!staging\BibTeX-custom-parser\automate_classification.py --mode remaining
D:\!staging\BibTeX-custom-parser\.venv\Scripts\python D:\!staging\BibTeX-custom-parser\verify_classification.py --mode remaining
pause
```

```text
# !reclassify_and_verify_all.bat
@echo off
echo Are you sure you want to re-classify ALL papers?
pause
D:\!staging\BibTeX-custom-parser\.venv\Scripts\python D:\!staging\BibTeX-custom-parser\automate_classification.py --mode all
D:\!staging\BibTeX-custom-parser\.venv\Scripts\python D:\!staging\BibTeX-custom-parser\verify_classification.py --mode all
pause
```

```python
# automate_classification.py
# automate_classification
# This should be agnostic to changes inside features and techniques:
import sqlite3
import json
import argparse
import time
import os
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
import queue
import threading
import signal

import globals  #globals.py for global settings and variables used by multiple files.

# Using a simple boolean guarded by a lock for absolute immediacy
shutdown_lock = threading.Lock()
shutdown_flag = False

def build_prompt(paper_data, template_content):
    """Builds the prompt string for a single paper using a loaded template."""
    format_data = {
        'title': paper_data.get('title', ''),
        'abstract': paper_data.get('abstract', ''),
        'keywords': paper_data.get('keywords', ''),
        'authors': paper_data.get('authors', ''),
        'year': paper_data.get('year', ''),
        'type': paper_data.get('type', ''),
        'journal': paper_data.get('journal', ''),
    }
    try:
        return template_content.format(**format_data)
    except KeyError as e:
        print(f"Error formatting prompt: Missing key {e} in paper data or template expects it.")
        raise

def update_paper_from_llm(db_path, paper_id, llm_data, changed_by="LLM", reasoning_trace=None):
    """Updates paper classification fields in the database based on LLM output."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    changed_timestamp = datetime.utcnow().isoformat() + 'Z'
    update_fields = []
    update_values = []
    
    if reasoning_trace is not None:
        update_fields.append("reasoning_trace = ?")
        update_values.append(reasoning_trace)

    # Main Boolean Fields
    main_bool_fields = ['is_survey', 'is_offtopic', 'is_through_hole', 'is_smt', 'is_x_ray']
    for field in main_bool_fields:
        if field in llm_data:
            value = llm_data[field]
            update_fields.append(f"{field} = ?")
            update_values.append(1 if value is True else 0 if value is False else None)

    # Research Area and Relevance
    if 'research_area' in llm_data:
        update_fields.append("research_area = ?")
        update_values.append(llm_data['research_area'])

    if 'relevance' in llm_data:  # Add this line
        update_fields.append("relevance = ?")
        update_values.append(llm_data['relevance'])

    # Features
    cursor.execute("SELECT features FROM papers WHERE id = ?", (paper_id,))
    row = cursor.fetchone()
    current_features = json.loads(row[0]) if row and row[0] else {}
    if 'features' in llm_data and isinstance(llm_data['features'], dict):
        current_features.update(llm_data['features'])
        update_fields.append("features = ?")
        update_values.append(json.dumps(current_features))
    
    # Techniques
    cursor.execute("SELECT technique FROM papers WHERE id = ?", (paper_id,))
    row = cursor.fetchone()
    current_technique = json.loads(row[0]) if row and row[0] else {}
    if 'technique' in llm_data and isinstance(llm_data['technique'], dict):
        current_technique.update(llm_data['technique'])
        update_fields.append("technique = ?")
        update_values.append(json.dumps(current_technique))
    
    # Audit fields
    update_fields.append("changed = ?")
    update_values.append(changed_timestamp)
    update_fields.append("changed_by = ?")
    update_values.append(changed_by)
    
    if update_fields:
        update_query = f"UPDATE papers SET {', '.join(update_fields)} WHERE id = ?"
        update_values.append(paper_id)
        cursor.execute(update_query, update_values)
        conn.commit()
        rows_affected = cursor.rowcount
    else:
        rows_affected = 0
    conn.close()
    return rows_affected > 0

def process_paper_worker(db_path, grammar_content, prompt_template_content, paper_id_queue, progress_lock, processed_count, total_papers, model_alias):
    """Worker function executed by each thread."""
    while True:
        try:
            # Use timeout to periodically check for shutdown
            paper_id = paper_id_queue.get(timeout=1)
        except queue.Empty:
            # Check if we should shutdown periodically
            if globals.is_shutdown_flag_set():
                return
            continue

        # Poison pill - time to die
        if paper_id is None:
            return

        # Check for shutdown before processing
        if globals.is_shutdown_flag_set():
            return

        print(f"[Thread-{threading.get_ident()}] Processing paper ID: {paper_id}")
        
        try:
            paper_data = globals.get_paper_by_id(db_path, paper_id)
            if not paper_data:
                print(f"[Thread-{threading.get_ident()}] Error: Paper {paper_id} not found in DB.")
                continue
                
            prompt_text = build_prompt(paper_data, prompt_template_content)
            if globals.is_shutdown_flag_set():
                return
                
            json_result_str, model_name_used, reasoning_trace = globals.send_prompt_to_llm(
                prompt_text, 
                grammar_text=grammar_content, 
                server_url_base=globals.LLM_SERVER_URL, 
                model_name=model_alias,
                is_verification=False
            )
            
            if globals.is_shutdown_flag_set():
                return
                
            if json_result_str:
                try:
                    llm_classification = json.loads(json_result_str)
                    # Prepend model info to reasoning_trace
                    if reasoning_trace:
                        reasoning_trace = f"As classified by {model_name_used}\n\n{reasoning_trace}"
                    else:
                        reasoning_trace = f"As classified by {model_name_used}"

                    success = update_paper_from_llm(
                        db_path, 
                        paper_id, 
                        llm_classification, 
                        changed_by=model_name_used,
                        reasoning_trace=reasoning_trace
                    )
                    if success:
                        print(f"[Thread-{threading.get_ident()}] Updated paper {paper_id} (Model: {model_name_used})")
                    else:
                        print(f"[Thread-{threading.get_ident()}] No changes for paper {paper_id}")
                except json.JSONDecodeError as e:
                    print(f"[Thread-{threading.get_ident()}] Error parsing LLM output for {paper_id}: {e}")
                    print(f"LLM Output: {json_result_str}")
                except Exception as e:
                    print(f"[Thread-{threading.get_ident()}] Error updating DB for {paper_id}: {e}")
            else:
                if not globals.is_shutdown_flag_set():
                    print(f"[Thread-{threading.get_ident()}] No LLM response for {paper_id}")
        except Exception as e:
            if not globals.is_shutdown_flag_set():
                print(f"[Thread-{threading.get_ident()}] Error processing {paper_id}: {e}")
        finally:
            if globals.is_shutdown_flag_set():
                return
            with progress_lock:
                processed_count[0] += 1
                print(f"[Progress] Processed {processed_count[0]}/{total_papers} papers.")

def run_classification(mode='remaining', paper_id=None, db_file=None, grammar_file=None, prompt_template=None, server_url=None):
    """
    Runs the LLM classification process.

    Args:
        mode (str): 'all', 'remaining', or 'id'. Defaults to 'remaining'.
        paper_id (int, optional): The specific paper ID to classify (required if mode='id').
        db_file (str): Path to the SQLite database.
        grammar_file (str): Path to the GBNF grammar file.
        prompt_template (str): Path to the prompt template file.
        server_url (str): Base URL of the LLM server.
    """
    # Use globals for defaults if not provided
    if db_file is None:
        db_file = globals.DATABASE_FILE
    if grammar_file is None:
        grammar_file = globals.GRAMMAR_FILE
    if prompt_template is None:
        prompt_template = globals.PROMPT_TEMPLATE
    if server_url is None:
        server_url = globals.LLM_SERVER_URL

    if not os.path.exists(db_file):
        print(f"Error: Database file '{db_file}' not found.")
        return False

    try:
        prompt_template_content = globals.load_prompt_template(prompt_template)
        print(f"Loaded prompt template from '{prompt_template}'")
    except Exception as e:
        print(f"Failed to load prompt template: {e}")
        return False

    grammar_content = None
    if grammar_file:
        try:
            grammar_content = globals.load_grammar(grammar_file)
            print(f"Loaded GBNF grammar from '{grammar_file}'")
        except Exception as e:
            print(f"Error reading grammar file '{grammar_file}': {e}")
            grammar_content = None

    print("Fetching model alias from LLM server...")
    model_alias = globals.get_model_alias(server_url)
    if not model_alias:
        print("Error: Could not determine model alias. Exiting.")
        return False

    print(f"Connecting to database '{db_file}'...")
    try:
        conn = sqlite3.connect(db_file)
        cursor = conn.cursor()
        
        if mode == 'all':
            print("Fetching ALL papers for re-classification...")
            cursor.execute("SELECT id FROM papers")
        elif mode == 'id':
            if paper_id is None:
                print("Error: Mode 'id' requires a specific paper ID.")
                conn.close()
                return False
            print(f"Fetching specific paper ID: {paper_id} for classification...")
            cursor.execute("SELECT id FROM papers WHERE id = ?", (paper_id,))
            if not cursor.fetchone():
                 print(f"Warning: Paper ID {paper_id} not found in the database.")
                 conn.close()
                 return True
            cursor.execute("SELECT id FROM papers WHERE id = ?", (paper_id,))
        else: # Default to 'remaining'
            print("Fetching unprocessed papers (changed_by IS NULL or blank)...")
            cursor.execute("SELECT id FROM papers WHERE changed_by IS NULL OR changed_by = '' OR is_offtopic = '' OR is_offtopic IS NULL ") #set to reclassify when manually removing offtopic status
            
        paper_ids = [row[0] for row in cursor.fetchall()]
        conn.close()
        total_papers = len(paper_ids)
        print(f"Found {total_papers} paper(s) to process based on mode '{mode}'.")

        if not paper_ids:
            print("No papers found matching the criteria. Nothing to process.")
            return True

        paper_id_queue = queue.Queue()
        for pid in paper_ids:
            paper_id_queue.put(pid)

        # Add poison pills for each worker thread
        for _ in range(globals.MAX_CONCURRENT_WORKERS):
            paper_id_queue.put(None)

    except Exception as e:
        print(f"Error fetching paper IDs: {e}")
        return False

    progress_lock = threading.Lock()
    processed_count = [0]

    print(f"Starting ThreadPoolExecutor with {globals.MAX_CONCURRENT_WORKERS} workers...")
    start_time = time.time()
    
    try:
        with ThreadPoolExecutor(max_workers=globals.MAX_CONCURRENT_WORKERS) as executor:
            # Submit worker tasks
            futures = []
            for _ in range(globals.MAX_CONCURRENT_WORKERS):
                future = executor.submit(
                    process_paper_worker,
                    db_file,
                    grammar_content,
                    prompt_template_content,
                    paper_id_queue,
                    progress_lock,
                    processed_count,
                    total_papers,
                    model_alias
                )
                futures.append(future)
            
            print("Processing started. Press Ctrl+C to abort.")
            
            while not globals.is_shutdown_flag_set():
                if all(f.done() for f in futures):
                    break
                time.sleep(0.1)
            
            if globals.is_shutdown_flag_set():
                print("\nShutdown signal received. Waiting for threads to finish...")

    except KeyboardInterrupt:
        print("\nKeyboardInterrupt caught in run_classification. Setting shutdown flag.")
        globals.set_shutdown_flag()
    except Exception as e:
        print(f"Error in main execution loop: {e}")
        globals.set_shutdown_flag()
    finally:
        end_time = time.time()
        final_count = 0
        if progress_lock:
            with progress_lock:
                final_count = processed_count[0] if processed_count else 0
        print(f"\n--- Classification Summary ---")
        print(f"Papers processed: {final_count}/{total_papers}")
        print(f"Time taken: {end_time - start_time:.2f} seconds")
        print("Classification run finished.")
        return not globals.is_shutdown_flag_set()
    
    
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Automate LLM classification for papers in the database.')
    parser.add_argument('--mode', '-m', choices=['all', 'remaining', 'id'], default='remaining',
                        help="Processing mode: 'all' (classify everything), 'remaining' (classify unprocessed), 'id' (classify a specific paper). Default: 'remaining'.")
    parser.add_argument('--paper_id', '-i', type=int, help='Paper ID to classify (required if --mode id).')
    parser.add_argument('--db_file', default=globals.DATABASE_FILE,
                       help=f'SQLite database file path (default: {globals.DATABASE_FILE})')
    parser.add_argument('--grammar_file', '-g', default=globals.GRAMMAR_FILE,
                       help=f'Path to the GBNF grammar file (default: {globals.GRAMMAR_FILE})')
    parser.add_argument('--prompt_template', '-t', default=globals.PROMPT_TEMPLATE,
                       help=f'Path to the prompt template file (default: {globals.PROMPT_TEMPLATE})')
    parser.add_argument('--server_url', default=globals.LLM_SERVER_URL,
                       help=f'Base URL of the LLM server (default: {globals.LLM_SERVER_URL})')
    args = parser.parse_args()

    signal.signal(signal.SIGINT, globals.signal_handler)

    if args.mode == 'id' and args.paper_id is None:
        parser.error("--mode 'id' requires --paper_id to be specified.")

    success = run_classification(
        mode=args.mode,
        paper_id=args.paper_id,
        db_file=args.db_file,
        grammar_file=args.grammar_file,
        prompt_template=args.prompt_template,
        server_url=args.server_url
    )

    # Exit code is less critical now as signal_handler does os._exit(1)
    # But good practice to indicate success/failure for non-abort cases
    if not success and not globals.is_shutdown_flag_set():
        exit(1) 
    # If shutdown_flag is set, signal_handler already called os._exit(1)
    # Normal exit code 0 is implicit
```

```python
# browse_db.py
    # browse_db.py
import sqlite3
import json
import argparse
from datetime import datetime
from flask import Flask, render_template, request, jsonify
from markupsafe import Markup 
import argparse
import tempfile
import os
import sys
import threading
import webbrowser
from collections import Counter
import rcssmin
import rjsmin
import io
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill # Ensure PatternFill is imported
from openpyxl.worksheet.table import Table, TableStyleInfo
import gzip
import base64

# Import globals, the classification and verification modules
import globals
import automate_classification
import verify_classification

# Define default year range
DEFAULT_YEAR_FROM = 2016
DEFAULT_YEAR_TO = 2025
DEFAULT_MIN_PAGE_COUNT = 4

app = Flask(__name__)
DATABASE = None # Will be set from command line argument

# DB functions:

def ensure_fts_tables(conn):
    """
    Creates FTS5 virtual tables for searchable JSON text if they don't exist
    and populates them.
    This should ideally be called once at startup or when data changes.
    Handles potential NULLs and datatype mismatches robustly.
    """
    cursor = conn.cursor()
    
    # Check if FTS tables exist by checking for their docsize tables (internal to FTS)
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='papers_features_fts_docsize'")
    features_fts_exists = cursor.fetchone() is not None
    
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='papers_technique_fts_docsize'")
    technique_fts_exists = cursor.fetchone() is not None

    if not features_fts_exists:
        print("Creating FTS table for features JSON text...")
        # Create FTS table for features text (currently only 'other')
        # content='papers' links it to the main table, content_rowid='id' specifies the PK
        # papers_fts is the name, features_text is the column to be searched
        # Using 'porter' tokenizer can be helpful for matching word variations
        cursor.execute("""
            CREATE VIRTUAL TABLE papers_features_fts USING fts5(
                features_text, 
                content='papers', 
                content_rowid='id',
                tokenize='porter'
            )
        """)
        # Populate the FTS table for features
        # Extract text from features JSON. Handle potential NULLs/Non-JSON robustly.
        # COALESCE handles NULL features or NULL json_extract result.
        # IFNULL is similar to COALESCE in SQLite.
        # Ensure the final result passed to FTS is TEXT.
        # Using CAST(... AS TEXT) ensures text type, even if json_extract returns a number or the column is not strictly text.
        cursor.execute("""
            INSERT INTO papers_features_fts (rowid, features_text)
            SELECT id, CAST(COALESCE(json_extract(features, '$.other'), '') AS TEXT)
            FROM papers
        """)
        conn.commit()
        print("Features FTS table created and populated.")

    if not technique_fts_exists:
        print("Creating FTS table for technique JSON text...")
        # Create FTS table for technique text (currently only 'model')
        cursor.execute("""
            CREATE VIRTUAL TABLE papers_technique_fts USING fts5(
                technique_text, 
                content='papers', 
                content_rowid='id',
                tokenize='porter'
            )
        """)
        # Populate the FTS table for technique
        # Same robust handling for technique JSON and potential NULLs.
        cursor.execute("""
            INSERT INTO papers_technique_fts (rowid, technique_text)
            SELECT id, CAST(COALESCE(json_extract(technique, '$.model'), '') AS TEXT)
            FROM papers
        """)
        conn.commit()
        print("Technique FTS table created and populated.")

def get_db_connection():
    """Create a connection to the SQLite database and ensure FTS tables."""
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row  # Allows accessing columns by name
    # Ensure FTS tables exist and are populated
    # Note: For very large DBs or frequent updates, you might want a more sophisticated trigger/update mechanism
    # For now, checking/creating on every connection is a simple way to ensure they exist.
    # Consider optimizing this if performance on initial load becomes an issue.
    try:
        ensure_fts_tables(conn)
    except sqlite3.Error as e:
        print(f"Warning: Could not ensure FTS tables: {e}. Search might be slow or not work as expected for JSON text.")
        # Depending on requirements, you might want to raise the error or continue
        # raise # Re-raise if FTS is critical
    return conn

def get_total_paper_count():
    """Get the total number of papers in the database."""
    conn = get_db_connection()
    try:
        count = conn.execute("SELECT COUNT(*) FROM papers").fetchone()[0]
        return count
    finally:
        conn.close()

# --- Helper Functions ---

def format_changed_timestamp(changed_str):
    """Format the ISO timestamp string to dd/mm/yy hh:mm:ss"""
    if not changed_str:
        return ""
    try:
        dt = datetime.fromisoformat(changed_str.replace('Z', '+00:00'))
        return dt.strftime("%d/%m/%y %H:%M:%S")
    except ValueError:
        # If parsing fails, return the original string or a placeholder
        return changed_str

def truncate_authors(authors_str, max_authors=2):
    """Truncate the authors list for the main table view."""
    if not authors_str:
        return ""
    authors_list = [a.strip() for a in authors_str.split(';')]
    if len(authors_list) > max_authors:
        return "; ".join(authors_list[:max_authors]) + " et al."
    else:
        return authors_str

def fetch_papers(hide_offtopic=True, year_from=None, year_to=None, min_page_count=None, search_query=None):
    """Fetch papers from the database, applying various optional filters."""
    conn = get_db_connection()
    # Start building the main query parts
    # We will JOIN with the FTS results if there's a search query
    base_query = "SELECT p.* FROM papers p"
    conditions = []
    params = []

    # --- Existing Filters (remain the same) ---
    if hide_offtopic:
        conditions.append("(p.is_offtopic = 0 OR p.is_offtopic IS NULL)")
    if year_from is not None:
        try:
            year_from = int(year_from)
            conditions.append("p.year >= ?")
            params.append(year_from)
        except (ValueError, TypeError):
            pass
    if year_to is not None:
        try:
            year_to = int(year_to)
            conditions.append("p.year <= ?")
            params.append(year_to)
        except (ValueError, TypeError):
            pass
    if min_page_count is not None:
        try:
            min_page_count = int(min_page_count)
            conditions.append("(p.page_count IS NULL OR p.page_count = '' OR p.page_count >= ?)")
            params.append(min_page_count)
        except (ValueError, TypeError):
            pass

    # --- MODIFIED: Search Filter using FTS ---
    fts_join_clause = "" # To hold the JOIN clause if FTS is used
    if search_query:
        # Sanitize the search query for FTS. Basic escaping for quotes.
        # FTS5 handles most things well, but escaping quotes is generally good practice.
        # Using parameterized queries handles the main injection risk.
        # For complex FTS queries (phrases, boolean operators), more processing might be needed.
        
        # Define the columns to search in the main table (excluding JSON columns now)
        searchable_columns = [
            'p.id', 'p.type', 'p.title', 'p.authors', 'p.month', 'p.journal',
            'p.volume', 'p.pages', 'p.doi', 'p.issn', 'p.abstract', 'p.keywords',
            'p.research_area', 'p.user_trace' # Include user_trace in search
        ]
        
        # Create a list of LIKE conditions for each searchable column (basic text search)
        # Alternatively, you could include these in the FTS search if you denormalized them into an FTS table too.
        search_conditions = []
        search_term_like = f"%{search_query}%" # For LIKE on non-FTS columns
        for col in searchable_columns:
            search_conditions.append(f"LOWER({col}) LIKE LOWER(?)")
            params.append(search_term_like)

        # --- NEW: Handle JSON text search using FTS ---
        # We will JOIN the main papers table with the results from FTS searches on the virtual tables.
        # We'll search both FTS tables and UNION the results to get relevant paper IDs.
                
        # Ensure the search query itself is safe for FTS phrase search (mainly about escaping internal quotes)
        # A simple way is to escape double quotes or remove them, or wrap in single quotes if needed.
        # For basic robustness against the hyphen issue, phrase search is good.
        escaped_search_query = search_query.replace('"', '""') # Escape double quotes for FTS phrase syntax
        fts_search_term = f'"{escaped_search_query}"' # Force phrase matching in FTS
        # Create a subquery that finds matching rowids from both FTS tables
        fts_subquery = f"""
            SELECT rowid FROM papers_features_fts WHERE papers_features_fts MATCH ?
            UNION
            SELECT rowid FROM papers_technique_fts WHERE papers_technique_fts MATCH ?
        """
        # Add the FTS search term twice (once for each FTS table search)
        params.append(fts_search_term)
        params.append(fts_search_term)
        # Combine the LIKE conditions with the FTS requirement
        # An paper matches if it matches any non-JSON field (LIKE) OR if it's in the FTS results
        if search_conditions:
             # If there are non-JSON fields matched by LIKE
             non_json_search_condition = " OR ".join(search_conditions)
             conditions.append(f"(({non_json_search_condition}) OR p.id IN ({fts_subquery}))")
        else:
            # If no non-JSON fields are searched, only rely on FTS
            # This case is less likely given the columns listed, but handle it
            conditions.append(f"p.id IN ({fts_subquery})")

    # --- Build Final Query ---
    # Start with base query
    query_parts = [base_query]
    
    # Add WHERE clause if conditions exist
    if conditions:
        query_parts.append("WHERE " + " AND ".join(conditions))

    # Combine all parts
    query = " ".join(query_parts)

    try:
        papers = conn.execute(query, params).fetchall()
    except sqlite3.Error as e:
        conn.close()
        print(f"Database error during fetch_papers: {e}")
        raise # Re-raise to be caught by the calling function (e.g., render_papers_table)
    finally:
        conn.close()

    # --- Process Results (Same as before) ---
    paper_list = []
    for paper in papers:
        paper_dict = dict(paper)
        try:
            paper_dict['features'] = json.loads(paper_dict['features'])
        except (json.JSONDecodeError, TypeError):
            paper_dict['features'] = {}
        try:
            paper_dict['technique'] = json.loads(paper_dict['technique'])
        except (json.JSONDecodeError, TypeError):
            paper_dict['technique'] = {}
        paper_dict['changed_formatted'] = format_changed_timestamp(paper_dict.get('changed'))
        paper_dict['authors_truncated'] = truncate_authors(paper_dict.get('authors', ''))
        paper_list.append(paper_dict)
    
    return paper_list

def update_paper_custom_fields(paper_id, data, changed_by="user"):
    """Update the custom classification fields for a paper and audit fields.
       Handles partial updates based on keys present in `data`."""

    conn = get_db_connection()
    cursor = conn.cursor()
    
    changed_timestamp = datetime.utcnow().isoformat() + 'Z'

    update_fields = []
    update_values = []

    # Handle Main Boolean Fields (Partial Update)
    main_bool_fields = ['is_survey', 'is_offtopic', 'is_through_hole', 'is_smt', 'is_x_ray']
    for field in main_bool_fields:
        if field in data:
            value = data[field]
            if isinstance(value, str):
                if value.lower() in ('true', '1', 'on'):
                    update_fields.append(f"{field} = ?")
                    update_values.append(1)
                elif value.lower() in ('false', '0'):
                    update_fields.append(f"{field} = ?")
                    update_values.append(0)
                else: # 'unknown', '', None, etc.
                    update_fields.append(f"{field} = ?")
                    update_values.append(None)
            elif value is True:
                update_fields.append(f"{field} = ?")
                update_values.append(1)
            elif value is False:
                update_fields.append(f"{field} = ?")
                update_values.append(0)
            else: # value is None or numeric
                update_fields.append(f"{field} = ?")
                update_values.append(int(bool(value)) if value is not None else None)

    # Handle Research Area (Partial Update)
    if 'research_area' in data:
        update_fields.append("research_area = ?")
        update_values.append(data['research_area'])


    page_count_value_for_pages_update = None # Variable to hold the value for potential 'pages' update
    if 'page_count' in data:
        page_count_value = data['page_count']
        if page_count_value is not None:
            try:
                page_count_value = int(page_count_value)
                # Store the integer value for potential 'pages' update
                page_count_value_for_pages_update = page_count_value 
            except (ValueError, TypeError):
                page_count_value = None
                page_count_value_for_pages_update = None # Reset if invalid
        else:
            page_count_value_for_pages_update = None # Reset if None
        
        update_fields.append("page_count = ?")
        update_values.append(page_count_value)

        cursor.execute("SELECT pages FROM papers WHERE id = ?", (paper_id,))
        row = cursor.fetchone()
        if row:
            current_pages_value = row['pages']
            # Check if 'pages' is effectively empty/blank/null
            # This checks for None, empty string, or string with only whitespace
            if current_pages_value is None or (isinstance(current_pages_value, str) and current_pages_value.strip() == ""):
                # If 'pages' is blank and we have a valid page_count to set
                if page_count_value_for_pages_update is not None:
                    # Add the update for the 'pages' column
                    update_fields.append("pages = ?")
                    # Convert the integer page count back to string for the 'pages' TEXT column
                    update_values.append(str(page_count_value_for_pages_update)) 
        # --- END NEW LOGIC ---

    # Handle Verified By (Partial Update)
    if 'verified_by' in data:
        verified_by_value = data['verified_by']
        # Ensure value is either 'user' or None. Others (like model names) are treated as None.
        # This enforces that the UI can only set 'user' or clear it.
        if verified_by_value != 'user':
            verified_by_value = None
        update_fields.append("verified_by = ?")
        update_values.append(verified_by_value)
        

    # Handle Features (Partial Update)
    # Fetch current features JSON from DB to merge changes
    cursor.execute("SELECT features FROM papers WHERE id = ?", (paper_id,))
    row = cursor.fetchone()
    if row:
        try:
            current_features = json.loads(row['features']) if row['features'] else {}
        except (json.JSONDecodeError, TypeError):
            current_features = {}
    else:
        current_features = {}

    # Check for feature fields in the incoming data
    feature_updates = {}
    for key in list(data.keys()): # Iterate over a copy to safely modify data
        if key.startswith('features_'):
            feature_key = key.split('features_')[1]
            value = data.pop(key) # Remove from main data dict
            if feature_key == 'other':
                feature_updates[feature_key] = value # Text field
            else:
                # Handle radio button group for 3-state (true/false/unknown)
                if isinstance(value, str):
                    if value == 'true':
                        feature_updates[feature_key] = True
                    elif value == 'false':
                        feature_updates[feature_key] = False
                    else: # 'unknown' or anything else
                        feature_updates[feature_key] = None
                elif isinstance(value, bool):
                    feature_updates[feature_key] = value
                else: # None or numeric
                    feature_updates[feature_key] = bool(value) if value is not None else None

    if feature_updates:
        current_features.update(feature_updates)
        update_fields.append("features = ?")
        update_values.append(json.dumps(current_features))

    # Handle Techniques (Partial Update)
    # Fetch current technique JSON from DB to merge changes
    cursor.execute("SELECT technique FROM papers WHERE id = ?", (paper_id,))
    row = cursor.fetchone()
    if row:
        try:
            current_technique = json.loads(row['technique']) if row['technique'] else {}
        except (json.JSONDecodeError, TypeError):
            current_technique = {}
    else:
        current_technique = {}

    # Check for technique fields in the (potentially modified) data
    technique_updates = {}
    for key in list(data.keys()):
        if key.startswith('technique_'):
            technique_key = key.split('technique_')[1]
            value = data.pop(key) # Remove from main data dict
            if technique_key == 'model':
                technique_updates[technique_key] = value # Text field
            elif technique_key == 'available_dataset':
                 # Handle radio button group for 3-state (true/false/unknown)
                if isinstance(value, str):
                    if value == 'true':
                        technique_updates[technique_key] = True
                    elif value == 'false':
                        technique_updates[technique_key] = False
                    else: # 'unknown' or anything else
                        technique_updates[technique_key] = None
                elif isinstance(value, bool):
                    technique_updates[technique_key] = value
                else: # None or numeric
                    technique_updates[technique_key] = bool(value) if value is not None else None
            else: # classic_computer_vision_based, machine_learning_based, hybrid
                 # Handle radio button group for 3-state (true/false/unknown)
                if isinstance(value, str):
                    if value == 'true':
                        technique_updates[technique_key] = True
                    elif value == 'false':
                        technique_updates[technique_key] = False
                    else: # 'unknown' or anything else
                        technique_updates[technique_key] = None
                elif isinstance(value, bool):
                    technique_updates[technique_key] = value
                else: # None or numeric
                    technique_updates[technique_key] = bool(value) if value is not None else None

    # Merge updates into current technique
    if technique_updates:
        current_technique.update(technique_updates)
        update_fields.append("technique = ?")
        update_values.append(json.dumps(current_technique))

    # Always update audit fields for any change
    update_fields.append("changed = ?")
    update_values.append(changed_timestamp)
    update_fields.append("changed_by = ?")
    update_values.append(changed_by)

    # Any remaining keys in 'data' are assumed to be direct column names
    for key, value in data.items(): # Iterate over the potentially modified data dict
        # Skip keys already handled or special keys
        if key in ['id', 'changed', 'changed_by', 'verified_by'] or key in main_bool_fields or key.startswith(('features_', 'technique_')):
            continue
        # Treat remaining keys as direct column updates
        update_fields.append(f"{key} = ?")
        update_values.append(value)

    if update_fields:
        update_query = f"UPDATE papers SET {', '.join(update_fields)} WHERE id = ?"
        update_values.append(paper_id)
        # --- Debug prints ---
        # print(f"DEBUG: Updating paper {paper_id}")
        # print(f"DEBUG: SQL Query: {update_query}")
        # print(f"DEBUG: Values: {update_values}")
        # --- End Debug prints ---
        cursor.execute(update_query, update_values)
        conn.commit()
        rows_affected = cursor.rowcount
    else:
        rows_affected = 0 # No fields to update
    conn.close()

    if rows_affected > 0:
        conn = get_db_connection()
        updated_paper = conn.execute("SELECT * FROM papers WHERE id = ?", (paper_id,)).fetchone()
        conn.close()
        
        if updated_paper:
            updated_dict = dict(updated_paper)
            try:
                updated_dict['features'] = json.loads(updated_dict['features'])
            except (json.JSONDecodeError, TypeError):
                updated_dict['features'] = {}
            try:
                updated_dict['technique'] = json.loads(updated_dict['technique'])
            except (json.JSONDecodeError, TypeError):
                updated_dict['technique'] = {}
            
            updated_dict['changed_formatted'] = format_changed_timestamp(updated_dict.get('changed'))
            

            return_data = {
                'status': 'success',
                'changed': updated_dict.get('changed'),
                'changed_formatted': updated_dict['changed_formatted'],
                'changed_by': updated_dict.get('changed_by'),
                # Include updated fields for frontend refresh
                'research_area': updated_dict.get('research_area'),
                'page_count': updated_dict.get('page_count'),
                'is_survey': updated_dict.get('is_survey'),
                'is_offtopic': updated_dict.get('is_offtopic'),
                'is_through_hole': updated_dict.get('is_through_hole'),
                'is_smt': updated_dict.get('is_smt'),
                'is_x_ray': updated_dict.get('is_x_ray'),
                'relevance': updated_dict.get('relevance'),
                'features': updated_dict['features'], # Parsed dict
                'technique': updated_dict['technique'], # Parsed dict
                'user_trace': updated_dict.get('user_trace')
            }
            return return_data
        else:
            return {'status': 'error', 'message': 'Paper not found after update.'}
    else:
        return {'status': 'error', 'message': 'No rows updated. Paper ID might not exist or no changes were made.'}

def fetch_updated_paper_data(paper_id):
    """Fetches the full paper data after classification/verification for client-side update."""
    conn = get_db_connection()
    try:
        updated_paper = conn.execute("SELECT * FROM papers WHERE id = ?", (paper_id,)).fetchone()
        if updated_paper:
            updated_dict = dict(updated_paper)
            try:
                updated_dict['features'] = json.loads(updated_dict['features'])
            except (json.JSONDecodeError, TypeError):
                updated_dict['features'] = {}
            try:
                updated_dict['technique'] = json.loads(updated_dict['technique'])
            except (json.JSONDecodeError, TypeError):
                updated_dict['technique'] = {}
            updated_dict['changed_formatted'] = format_changed_timestamp(updated_dict.get('changed'))
            
            # Prepare data for frontend refresh (matching update_paper_custom_fields structure)
            return_data = {
                'status': 'success',
                'changed': updated_dict.get('changed'),
                'changed_formatted': updated_dict['changed_formatted'],
                'changed_by': updated_dict.get('changed_by'),
                'verified_by': updated_dict.get('verified_by'),
                # Include updated fields for frontend refresh
                'research_area': updated_dict.get('research_area'),
                'page_count': updated_dict.get('page_count'),
                'is_survey': updated_dict.get('is_survey'),
                'is_offtopic': updated_dict.get('is_offtopic'),
                'is_through_hole': updated_dict.get('is_through_hole'),
                'is_smt': updated_dict.get('is_smt'),
                'is_x_ray': updated_dict.get('is_x_ray'),
                'relevance': updated_dict.get('relevance'),
                'verified': updated_dict.get('verified'),
                'estimated_score': updated_dict.get('estimated_score'),
                'features': updated_dict['features'], # Parsed dict
                'technique': updated_dict['technique'], # Parsed dict
                'reasoning_trace': updated_dict.get('reasoning_trace'), # Include traces
                'verifier_trace': updated_dict.get('verifier_trace'),
                'user_trace': updated_dict.get('user_trace')
            }
            return return_data
        else:
            return {'status': 'error', 'message': 'Paper not found after update.'}
    finally:
        conn.close()
  
def render_papers_table(hide_offtopic_param=None, year_from_param=None, year_to_param=None, min_page_count_param=None, search_query_param=None):
    """Fetches papers based on filters and renders the papers_table.html template. 
       Used for initial render from / and XHR updates."""
    try:
        # Determine hide_offtopic state
        hide_offtopic = True # Default
        if hide_offtopic_param is not None:
            hide_offtopic = hide_offtopic_param.lower() in ['1', 'true', 'yes', 'on']

        # Determine filter values, using defaults if not provided or invalid
        year_from_value = int(year_from_param) if year_from_param is not None else DEFAULT_YEAR_FROM
        year_to_value = int(year_to_param) if year_to_param is not None else DEFAULT_YEAR_TO
        min_page_count_value = int(min_page_count_param) if min_page_count_param is not None else DEFAULT_MIN_PAGE_COUNT
        # --- NEW: Determine search query value ---
        search_query_value = search_query_param if search_query_param is not None else ""

        # Fetch papers with ALL the filters applied, including the new search query
        papers = fetch_papers(
            hide_offtopic=hide_offtopic,
            year_from=year_from_value,
            year_to=year_to_value,
            min_page_count=min_page_count_value,
            search_query=search_query_value # Pass the search query
        )

        # Render the table template fragment, passing the search query value for the input field
        rendered_table = render_template(
            'papers_table.html',
            papers=papers,
            type_emojis=globals.TYPE_EMOJIS,
            default_type_emoji=globals.DEFAULT_TYPE_EMOJI,
            hide_offtopic=hide_offtopic,
            # Pass the *string representations* of the values to the template for input fields
            year_from_value=str(year_from_value),
            year_to_value=str(year_to_value),
            min_page_count_value=str(min_page_count_value),
            # --- NEW: Pass search query value ---
            search_query_value=search_query_value
        )
        return rendered_table
    except Exception as e:
        # Log the error or handle it appropriately
        print(f"Error rendering papers table: {e}")
        # Return an error fragment or re-raise if preferred for the main route
        return "<p>Error loading table.</p>" # Basic error display


#Routes: 
@app.route('/', methods=['GET'])
def index():
    """Main page to display the table."""
    # Get initial filter parameters from the request (or they will default inside render_papers_table)
    hide_offtopic_param = request.args.get('hide_offtopic')
    year_from_param = request.args.get('year_from')
    year_to_param = request.args.get('year_to')
    min_page_count_param = request.args.get('min_page_count')

    search_query_param = request.args.get('search_query')
    total_paper_count = get_total_paper_count()

    papers_table_content = render_papers_table(
        hide_offtopic_param=hide_offtopic_param,
        year_from_param=year_from_param,
        year_to_param=year_to_param,
        min_page_count_param=min_page_count_param,
        search_query_param=search_query_param,
    )
    # Pass the rendered table content and filter values to the main index template
    # Determine values to display in the input fields (use defaults if URL params were missing/invalid)
    try:
        year_from_input_value = str(int(year_from_param)) if year_from_param is not None else str(DEFAULT_YEAR_FROM)
    except ValueError:
        year_from_input_value = str(DEFAULT_YEAR_FROM)
    try:
        year_to_input_value = str(int(year_to_param)) if year_to_param is not None else str(DEFAULT_YEAR_TO)
    except ValueError:
        year_to_input_value = str(DEFAULT_YEAR_TO)
    try:
        min_page_count_input_value = str(int(min_page_count_param)) if min_page_count_param is not None else str(DEFAULT_MIN_PAGE_COUNT)
    except ValueError:
        min_page_count_input_value = str(DEFAULT_MIN_PAGE_COUNT)
    hide_offtopic_checkbox_checked = hide_offtopic_param is None or hide_offtopic_param.lower() in ['1', 'true', 'yes', 'on']
    search_input_value = search_query_param if search_query_param is not None else ""

    return render_template(
        'index.html',
        papers_table_content=papers_table_content,
        hide_offtopic=hide_offtopic_checkbox_checked,
        year_from_value=year_from_input_value,
        year_to_value=year_to_input_value,
        min_page_count_value=min_page_count_input_value,
        search_query_value=search_input_value,
        total_paper_count=total_paper_count
    )


@app.route('/static_export', methods=['GET'])
def static_export():
    """Generate and serve a downloadable HTML snapshot based on current filters."""
    # --- Get filter parameters from the request (URL query params) ---
    hide_offtopic_param = request.args.get('hide_offtopic')
    year_from_param = request.args.get('year_from')
    year_to_param = request.args.get('year_to')
    min_page_count_param = request.args.get('min_page_count')
    search_query_param = request.args.get('search_query') # Include search

    # --- NEW: Get the 'lite' parameter ---
    lite_param = request.args.get('lite', default='0') # Default to '0' (full content)
    is_lite_export = lite_param.lower() in ['1', 'true', 'yes']
    # --- END NEW ---

    # --- NEW: Get the 'download' parameter ---
    download_param = request.args.get('download', default='1') # Default to '1' (download)
    # --- END NEW ---

    # --- Determine filter values, using defaults if not provided or invalid ---
    hide_offtopic = True # Default
    if hide_offtopic_param is not None:
        hide_offtopic = hide_offtopic_param.lower() in ['1', 'true', 'yes', 'on']
    year_from_value = int(year_from_param) if year_from_param is not None else DEFAULT_YEAR_FROM
    year_to_value = int(year_to_param) if year_to_param is not None else DEFAULT_YEAR_TO
    min_page_count_value = int(min_page_count_param) if min_page_count_param is not None else DEFAULT_MIN_PAGE_COUNT
    search_query_value = search_query_param if search_query_param is not None else ""
    # --- Fetch papers based on these filters ---
    papers = fetch_papers(
        hide_offtopic=hide_offtopic,
        year_from=year_from_value,
        year_to=year_to_value,
        min_page_count=min_page_count_value,
        search_query=search_query_value # Pass the search query
    )

    # --- NEW: Blank 'fat text' fields if requested ---
    if is_lite_export:
        for paper in papers:
            # Blank the specified 'fat text' fields
            # Ensure features/technique are dicts for consistency if accessed later in template
            paper['abstract'] = '' # Blank Abstract
            paper['reasoning_trace'] = '' # Blank Classifier Trace
            paper['verifier_trace'] = '' # Blank Verifier Trace
            # Keep user_trace as is
            # Ensure features and technique are dictionaries (they should be already from fetch_papers)
            # But blanking their text content might be needed depending on template usage.
            # If the template directly accesses features['other'] or technique['model'],
            # blanking the *paper* dict keys might not be sufficient.
            # However, if the template iterates over features/technique keys, blanking
            # the text content within the JSON is better.
            # Let's blank the top-level text fields as requested.
            # If template access patterns require blanking within the JSON dict,
            # that logic would go here, but blanking the top-level fields is usually sufficient
            # for HTML rendering if the template just outputs {{ paper.abstract }} etc.
    # --- END NEW ---

    # --- Read static file contents ---
    fonts_css_content = ""
    style_css_content = ""
    chart_js_content = ""
    ghpages_js_content = ""
    # Assuming static files are in a 'static' directory relative to the script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    static_dir = os.path.join(script_dir, 'static')
    with open(os.path.join(static_dir, 'fonts.css'), 'r', encoding='utf-8') as f:
        fonts_css_content = f.read()
    with open(os.path.join(static_dir, 'style.css'), 'r', encoding='utf-8') as f:
        style_css_content = f.read()
    with open(os.path.join(static_dir, 'chart.js'), 'r', encoding='utf-8') as f:
        chart_js_content = f.read()
    with open(os.path.join(static_dir, 'ghpages.js'), 'r', encoding='utf-8') as f:
        ghpages_js_content = f.read()
    # --- Minify static content ---
    fonts_css_content = rcssmin.cssmin(fonts_css_content)
    style_css_content = rcssmin.cssmin(style_css_content)
    chart_js_content = rjsmin.jsmin(chart_js_content)
    ghpages_js_content = rjsmin.jsmin(ghpages_js_content)
    # --- Render the static export template ---
    # Pass the (potentially minified) static content to the papers table template
    papers_table_static_export = render_template(
        'papers_table_static_export.html',
        papers=papers, # Pass the potentially modified papers list
        type_emojis=globals.TYPE_EMOJIS,
        default_type_emoji=globals.DEFAULT_TYPE_EMOJI,
        hide_offtopic=hide_offtopic,
        year_from_value=str(year_from_value),
        year_to_value=str(year_to_value),
        min_page_count_value=str(min_page_count_value),
        search_query_value=search_query_value
    )
    # --- Render the main static export index template ---
    # Pass the (potentially minified) static content
    full_html_content = render_template(
        'index_static_export.html',
        papers_table_static_export=papers_table_static_export,
        hide_offtopic=hide_offtopic,
        year_from_value=year_from_value, # Pass raw values if needed by template logic
        year_to_value=year_to_value,
        min_page_count_value=min_page_count_value,
        search_query=search_query_value,
        # --- Pass potentially minified static content ---
        fonts_css_content=Markup(fonts_css_content), # Markup was already applied if needed, or content is minified
        style_css_content=Markup(style_css_content),
        chart_js_content=Markup(chart_js_content),
        ghpages_js_content=Markup(ghpages_js_content)
    )
    # # --- Minify the final HTML ---
    # # Doesn't really work since it minifies away all newlines from thinking traces even with <!-- htmlmin:ignore -->
    # # htmlmin options can be adjusted. remove_empty_space=True is common.
    # full_html_content = htmlmin.minify(
    #     full_html_content,
    #     remove_empty_space=False,
    #     reduce_boolean_attributes=True,
    #     remove_optional_attribute_quotes=True,
    #     remove_comments=False, # Enable if you want to remove HTML comments
    #     keep_pre=True, # Important if you have <pre> tags that need formatting
    # )
    pako_js_content = ""
    # Assuming pako.min.js is in your 'static' directory
    with open(os.path.join(static_dir, 'pako.min.js'), 'r', encoding='utf-8') as f:
        pako_js_content = f.read()
    # --- Compress the full HTML content ---
    # 1. Encode the HTML string to bytes (UTF-8)
    html_bytes = full_html_content.encode('utf-8')
    # 2. Compress the bytes
    compressed_bytes = gzip.compress(html_bytes)
    # 3. Encode the compressed bytes to Base64 for embedding in JS
    compressed_base64 = base64.b64encode(compressed_bytes).decode('ascii')
    # --- Render the LOADER template, passing the compressed data ---
    loader_html_content = render_template(
        'loader.html',
        compressed_html_data=compressed_base64,
        pako_js_content=Markup(pako_js_content) # Use Markup if passing raw JS
        # ... other variables ...
    )
    # --- Create a filename based on filters ---
    filename_parts = ["ResearchParça"]
    if year_from_value == year_to_value:
            filename_parts.append(str(year_from_value))
    else:
            filename_parts.append(f"{year_from_value}-{year_to_value}")
    if min_page_count_value > 0:
            filename_parts.append(f"min{min_page_count_value}pg")
    if hide_offtopic:
            filename_parts.append("noOfftopic")
    if search_query_value:
            # Sanitize search query for filename (basic)
            safe_search = "".join(c for c in search_query_value if c.isalnum() or c in (' ', '-', '_')).rstrip()
            if safe_search:
                filename_parts.append(f"search_{safe_search[:20]}") # Limit length

    # --- NEW: Append 'lite' to filename if applicable ---
    if is_lite_export:
        filename_parts.append("lite")
    # --- END NEW ---

    filename = "_".join(filename_parts) + ".html"
    # --- Prepare Response Headers ---
    from flask import Response
    response_headers = {"Content-Type": "text/html"} # Ensure correct content type
    # --- MODIFIED: Determine Content-Disposition based on 'download' parameter ---
    if download_param == '0':
        # If download=0, set Content-Disposition to 'inline' to display in browser
        response_headers["Content-Disposition"] = f"inline; filename={filename}"
        print(f"Serving static export inline: {filename}") # Optional: Log action
    else:
        # Default behavior: prompt for download
        response_headers["Content-Disposition"] = f"attachment; filename={filename}"
        print(f"Sending static export as attachment: {filename}") # Optional: Log action
    # --- END MODIFIED ---
    # --- Return the LOADER HTML with appropriate headers ---
    return Response(
        loader_html_content, # Send the small loader with embedded compressed data
        mimetype="text/html",
        headers=response_headers # Use the prepared headers
    )

@app.route('/xlsx_export', methods=['GET'])
def export_excel():
    """Generate and serve a downloadable Excel (.xlsx) file based on current filters."""
    # --- Get filter parameters from the request (URL query params) ---
    hide_offtopic_param = request.args.get('hide_offtopic')
    year_from_param = request.args.get('year_from')
    year_to_param = request.args.get('year_to')
    min_page_count_param = request.args.get('min_page_count')
    search_query_param = request.args.get('search_query') # Include search

    # --- Determine filter values, using defaults if not provided or invalid ---
    hide_offtopic = True # Default
    if hide_offtopic_param is not None:
        hide_offtopic = hide_offtopic_param.lower() in ['1', 'true', 'yes', 'on']
    year_from_value = int(year_from_param) if year_from_param is not None else DEFAULT_YEAR_FROM
    year_to_value = int(year_to_param) if year_to_param is not None else DEFAULT_YEAR_TO
    min_page_count_value = int(min_page_count_param) if min_page_count_param is not None else DEFAULT_MIN_PAGE_COUNT
    search_query_value = search_query_param if search_query_param is not None else ""

    # --- Fetch papers based on these filters ---
    papers = fetch_papers(
        hide_offtopic=hide_offtopic,
        year_from=year_from_value,
        year_to=year_to_value,
        min_page_count=min_page_count_value,
        search_query=search_query_value # Pass the search query
    )

    # --- Create Excel Workbook in Memory ---
    output = io.BytesIO()
    wb = Workbook()
    ws = wb.active
    ws.title = "PCB Inspection Papers"

    # --- Define Headers (Matching your request, translated for clarity if needed) ---
    # Note: Headers themselves can be in any language, but English keys are often easier for formulas.
    # If you need headers in another language, translate this list.
    headers = [
        "Type", "Title", "Year", "Journal/Conf name", "Pages count",
        # Features
        "Off-topic", "Relevance", "Survey", "THT", "SMT", "X-Ray",
        "Tracks", "Holes", "Solder Insufficient", "Solder Excess",
        "Solder Void", "Solder Crack", "Missing Comp", "Wrong Comp",
        "Orientation", "Cosmetic", "Other_state", "Other defects",
        # Techniques
        "Classic CV", "ML", "CNN Classifier", "CNN Detector",
        "R-CNN Detector", "Transformers", "Other", "Hybrid", "Datasets",
        "Model name",
        # Metadata
        "Last Changed", "Changed By", "Verified", "Accr. Score", "Verified By",
        "User Comment State", "User Comments"
    ]

    # --- Write Headers ---
    for col_num, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_num, value=header)
        cell.font = Font(bold=True)
        # Optional: Add background color to header
        # from openpyxl.styles import PatternFill
        # cell.fill = PatternFill(start_color="CCCCCC", end_color="CCCCCC", fill_type="solid")

    # --- Write Data Rows ---
    for row_num, paper in enumerate(papers, 2): # Start from row 2
        # --- Helper function for consistent Excel value conversion ---
        def format_excel_value(val):
            """
            Converts Python/DB values to Excel-friendly values:
            - True/1   -> TRUE (Excel boolean)
            - False/0  -> FALSE (Excel boolean)
            - None/''/etc. -> "" (Empty string for blank Excel cell)
            - Other    -> str(val) (Text)
            """
            if val is True or (isinstance(val, (int, float)) and val == 1):
                return True # Excel TRUE
            elif val is False or (isinstance(val, (int, float)) and val == 0):
                return False # Excel FALSE
            elif val is None or val == "":
                 return "" # Explicitly empty cell for NULL/empty
            else:
                # Handle potential string representations of booleans from inconsistent DB
                if isinstance(val, str):
                    lower_val = val.lower()
                    if lower_val in ('true', '1'):
                        return True
                    elif lower_val in ('false', '0'):
                        return False
                    # elif lower_val in ('null', 'none', ''): # If DB stores 'null' as string
                    #     return ""
                # Default: Convert to string for text fields
                return str(val)

        # Extract and format data
        features = paper.get('features', {})
        technique = paper.get('technique', {})

        # --- Format the 'Last Changed' date ---
        changed_timestamp_str = paper.get('changed', '')
        formatted_changed_date = ""
        if changed_timestamp_str:
            try:
                # Parse the ISO format timestamp
                dt = datetime.fromisoformat(changed_timestamp_str.replace('Z', '+00:00'))
                # Format as 'YYYY-MM-DD HH:MM:SS' for Excel compatibility
                formatted_changed_date = dt.strftime("%Y-%m-%d %H:%M:%S")
            except ValueError:
                # If parsing fails, keep the original string or leave blank
                formatted_changed_date = changed_timestamp_str # Or ""

        row_data = [
            paper.get('type', ''),                    # Type (text)
            paper.get('title', ''),                   # Title (text)
            paper.get('year'),                        # Year (integer)
            paper.get('journal', ''),                 # Journal/Conf name (text)
            paper.get('page_count'),                  # Pages count (integer)

            # --- Features ---
            # Use format_excel_value for ALL boolean/nullable fields
            format_excel_value(paper.get('is_offtopic')), # Off-topic (boolean/null)
            paper.get('relevance'),                   # Relevance (integer)
            format_excel_value(paper.get('is_survey')), # Survey (boolean/null)
            format_excel_value(paper.get('is_through_hole')), # THT (boolean/null)
            format_excel_value(paper.get('is_smt')),    # SMT (boolean/null)
            format_excel_value(paper.get('is_x_ray')),  # X-Ray (boolean/null) <-- CORRECTED
            format_excel_value(features.get('tracks')), # Tracks (boolean/null)
            format_excel_value(features.get('holes')),  # Holes (boolean/null)
            format_excel_value(features.get('solder_insufficient')), # Solder Insufficient (boolean/null)
            format_excel_value(features.get('solder_excess')), # Solder Excess (boolean/null)
            format_excel_value(features.get('solder_void')), # Solder Void (boolean/null)
            format_excel_value(features.get('solder_crack')), # Solder Crack (boolean/null)
            format_excel_value(features.get('missing_component')), # Missing Comp (boolean/null)
            format_excel_value(features.get('wrong_component')), # Wrong Comp (boolean/null)
            format_excel_value(features.get('orientation')), # Orientation (boolean/null)
            format_excel_value(features.get('cosmetic')), # Cosmetic (boolean/null)
            # Other_state (boolean based on 'other' text content) <-- CORRECTED
            format_excel_value(features.get('other') is not None and str(features.get('other', '')).strip() != ""),
            features.get('other', ''),               # Other defects (text) <-- This one shows the text

            # --- Techniques ---
            format_excel_value(technique.get('classic_cv_based')), # Classic CV (boolean/null)
            format_excel_value(technique.get('ml_traditional')), # ML (boolean/null)
            format_excel_value(technique.get('dl_cnn_classifier')), # CNN Classifier (boolean/null)
            format_excel_value(technique.get('dl_cnn_detector')), # CNN Detector (boolean/null)
            format_excel_value(technique.get('dl_rcnn_detector')), # R-CNN Detector (boolean/null)
            format_excel_value(technique.get('dl_transformer')), # Transformers (boolean/null)
            format_excel_value(technique.get('dl_other')), # Other (boolean/null)
            format_excel_value(technique.get('hybrid')), # Hybrid (boolean/null)
            format_excel_value(technique.get('available_dataset')), # Datasets (boolean/null)
            technique.get('model', ''),              # Model name (text)

            # --- Metadata ---
            formatted_changed_date,                 # Last Changed (formatted date string)
            paper.get('changed_by', ''),            # Changed By (text)
            format_excel_value(paper.get('verified')), # Verified (boolean/null)
            paper.get('estimated_score'),           # Accr. Score (integer)
            paper.get('verified_by', ''),           # Verified By (text)
            # User comments state (boolean based on 'user_trace' text content) <-- CORRECTED
            format_excel_value(paper.get('user_trace') is not None and str(paper.get('user_trace', '')).strip() != ""),
            paper.get('user_trace', '')             # User comments contents (text) <-- This one shows the text
        ]

        # Write the row data to Excel
        for col_num, cell_value in enumerate(row_data, 1):
            ws.cell(row=row_num, column=col_num, value=cell_value)


    # Optional: Auto-adjust column widths (basic attempt)
    for column in ws.columns:
        max_length = 0
        column_letter = column[0].column_letter # Get the column name
        for cell in column:
            try:
                if len(str(cell.value)) > max_length:
                    max_length = len(str(cell.value))
            except:
                pass
        adjusted_width = (max_length + 2)
        # Cap the width to prevent extremely wide columns
        ws.column_dimensions[column_letter].width = min(adjusted_width, 50)

    # Optional: Format the data as a table (requires openpyxl >= 2.5)
    try:
        if len(papers) > 0:
            # Adjust the column reference to 'AN' (assuming 34 columns: A through AN)
            # Headers are row 1, data starts row 2, so last row is len(papers) + 1
            tab = Table(displayName="PCBPapersTable", ref=f"A1:AN{len(papers) + 1}")
            style = TableStyleInfo(name="TableStyleMedium2", showFirstColumn=False,
                                   showLastColumn=False, showRowStripes=True, showColumnStripes=False)
            tab.tableStyleInfo = style
            ws.add_table(tab)
    except Exception as e:
        print(f"Warning: Could not create Excel table: {e}")

    # --- NEW: Apply Conditional Formatting for Boolean Cells ---
    # Define fills for TRUE and FALSE
    true_fill = PatternFill(start_color="CCFFCC", end_color="CCFFCC", fill_type="solid") # Light Green
    false_fill = PatternFill(start_color="FFCCCC", end_color="FFCCCC", fill_type="solid") # Light Red
    # Define the columns that contain boolean data (1-based index)
    # Based on your headers list:
    # Off-topic(6), Survey(8), THT(9), SMT(10), X-Ray(11),
    # Tracks(12), Holes(13), Solder Insufficient(14), Solder Excess(15),
    # Solder Void(16), Solder Crack(17), Missing Comp(18), Wrong Comp(19),
    # Orientation(20), Cosmetic(21), Other_state(22),
    # Classic CV(24), ML(25), CNN Classifier(26), CNN Detector(27),
    # R-CNN Detector(28), Transformers(29), Other(30), Hybrid(31), Datasets(32),
    # Verified(35), User Comment State(37)
    # Note: Skipping Relevance(7), Pages(5), Year(3) as they are numbers,
    # Other defects(23), Model name(33), Last Changed(34), Changed By(35-str),
    # Accr. Score(36-int), Verified By(37-str), User Comments(38-str)
    boolean_columns = [
        6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
        24, 25, 26, 27, 28, 29, 30, 31, 32, 35, 37 # Added 37 (User Comment State)
    ]

    # Iterate through rows and specified boolean columns to apply formatting
    for row in ws.iter_rows(min_row=2, max_row=ws.max_row, min_col=1, max_col=ws.max_column):
        for col_idx in boolean_columns:
            # Adjust for 0-based indexing in the row list
            cell = row[col_idx - 1] # col_idx is 1-based, list index is 0-based
            if cell.value is True:
                cell.fill = true_fill
            elif cell.value is False:
                cell.fill = false_fill
            # If cell.value is None or "", it remains unformatted (blank cell)

    # --- Optional: Format the data as a table (ensure column ref is correct) ---
    try:
        if len(papers) > 0:
            # Ensure the table reference matches the actual data width (AN = 34th column)
            # Assuming 34 columns (A-AN) based on headers list count.
            # If you added conditional formatting, it's still 34 columns.
            # Let's recount headers list to be sure:
            # 1. Type, 2. Title, 3. Year, 4. Journal/Conf name, 5. Pages count,
            # 6. Off-topic, 7. Relevance, 8. Survey, 9. THT, 10. SMT, 11. X-Ray,
            # 12. Tracks, 13. Holes, 14. Solder Insufficient, 15. Solder Excess,
            # 16. Solder Void, 17. Solder Crack, 18. Missing Comp, 19. Wrong Comp,
            # 20. Orientation, 21. Cosmetic, 22. Other_state, 23. Other defects,
            # 24. Classic CV, 25. ML, 26. CNN Classifier, 27. CNN Detector,
            # 28. R-CNN Detector, 29. Transformers, 30. Other, 31. Hybrid, 32. Datasets,
            # 33. Model name, 34. Last Changed, 35. Changed By, 36. Verified, 37. Accr. Score,
            # 38. Verified By, 39. User Comment State, 40. User Comments
            # Recount shows 40 columns. Excel columns: A=1, B=2, ..., AN=34, AO=35, AP=36, AQ=37, AR=38, AS=39, AT=40
            # Correct table reference should be A1:AT{len(papers)+1}
            tab = Table(displayName="PCBPapersTable", ref=f"A1:AT{len(papers) + 1}") # CHANGED TO AT - why?
            style = TableStyleInfo(name="TableStyleMedium2", showFirstColumn=False,
                                   showLastColumn=False, showRowStripes=True, showColumnStripes=False)
            tab.tableStyleInfo = style
            ws.add_table(tab)
    except Exception as e:
        print(f"Warning: Could not create Excel table: {e}")

    # --- Save Workbook to BytesIO object ---
    wb.save(output)
    output.seek(0)

    # --- Create a filename based on filters ---
    filename_parts = ["ResearchParça"]
    if year_from_value == year_to_value:
            filename_parts.append(str(year_from_value))
    else:
            filename_parts.append(f"{year_from_value}-{year_to_value}")
    if min_page_count_value > 0:
            filename_parts.append(f"min{min_page_count_value}pg")
    if hide_offtopic:
            filename_parts.append("noOfftopic")
    if search_query_value:
            # Sanitize search query for filename (basic)
            safe_search = "".join(c for c in search_query_value if c.isalnum() or c in (' ', '-', '_')).rstrip()
            if safe_search:
                filename_parts.append(f"search_{safe_search[:20]}") # Limit length
    filename = "_".join(filename_parts) + ".xlsx"

    # --- Return as a downloadable attachment ---
    from flask import Response
    return Response(
        output.getvalue(), # Get the bytes from the BytesIO object
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.route('/get_detail_row', methods=['GET'])
def get_detail_row():
    """Endpoint to fetch and render the detail row content for a specific paper."""
    paper_id = request.args.get('paper_id')
    if not paper_id:
        return jsonify({'status': 'error', 'message': 'Paper ID is required'}), 400

    try:
        conn = get_db_connection()
        paper = conn.execute("SELECT * FROM papers WHERE id = ?", (paper_id,)).fetchone()
        conn.close()

        if paper:
            # Process the paper data like in fetch_papers for consistency
            paper_dict = dict(paper)
            try:
                paper_dict['features'] = json.loads(paper_dict['features'])
            except (json.JSONDecodeError, TypeError):
                paper_dict['features'] = {}
            try:
                paper_dict['technique'] = json.loads(paper_dict['technique'])
            except (json.JSONDecodeError, TypeError):
                paper_dict['technique'] = {}
            
            # Render the detail row template fragment for this specific paper
            detail_html = render_template('detail_row.html', paper=paper_dict)
            return jsonify({'status': 'success', 'html': detail_html})
        else:
            return jsonify({'status': 'error', 'message': 'Paper not found'}), 404
    except Exception as e:
        print(f"Error fetching detail row for paper {paper_id}: {e}")
        return jsonify({'status': 'error', 'message': 'Failed to fetch detail row'}), 500

@app.route('/load_table', methods=['GET'])
def load_table():
    """Endpoint to fetch and render the table content based on current filters."""
    # Get filter parameters from the request
    hide_offtopic_param = request.args.get('hide_offtopic')
    year_from_param = request.args.get('year_from')
    year_to_param = request.args.get('year_to')
    min_page_count_param = request.args.get('min_page_count')
    search_query_param = request.args.get('search_query')

    # Use the updated helper function to render the table, passing the search query
    table_html = render_papers_table(
        hide_offtopic_param=hide_offtopic_param,
        year_from_param=year_from_param,
        year_to_param=year_to_param,
        min_page_count_param=min_page_count_param,
        search_query_param=search_query_param # Pass the search query
    )
    return table_html

@app.route('/get_stats', methods=['GET'])
def get_stats():
    """Endpoint to fetch statistics (repeating journals, keywords, authors, research areas) based on current filters."""
    
    # --- Get filter parameters from the request (same as /load_table) ---
    hide_offtopic_param = request.args.get('hide_offtopic')
    year_from_param = request.args.get('year_from')
    year_to_param = request.args.get('year_to')
    min_page_count_param = request.args.get('min_page_count')
    search_query_param = request.args.get('search_query')

    try:
        # --- Determine filter values, using defaults if not provided or invalid ---
        # Replicating logic from render_papers_table for consistency
        hide_offtopic = True # Default
        if hide_offtopic_param is not None:
            hide_offtopic = hide_offtopic_param.lower() in ['1', 'true', 'yes', 'on']

        year_from_value = int(year_from_param) if year_from_param is not None else DEFAULT_YEAR_FROM
        year_to_value = int(year_to_param) if year_to_param is not None else DEFAULT_YEAR_TO
        min_page_count_value = int(min_page_count_param) if min_page_count_param is not None else DEFAULT_MIN_PAGE_COUNT
        search_query_value = search_query_param if search_query_param is not None else ""

        # --- Fetch papers based on these filters ---
        papers = fetch_papers(
            hide_offtopic=hide_offtopic,
            year_from=year_from_value,
            year_to=year_to_value,
            min_page_count=min_page_count_value,
            search_query=search_query_value
        )

        # --- Calculate Stats from Fetched Papers ---
        journal_counter = Counter()
        keyword_counter = Counter()
        author_counter = Counter()
        research_area_counter = Counter()

        for paper in papers:
            # --- Journal/Conf ---
            journal = paper.get('journal')
            if journal:
                journal_counter[journal] += 1

            # --- Keywords ---
            # Keywords are stored as a single string, split by ';'
            keywords_str = paper.get('keywords', '')
            if keywords_str:
                 # Split robustly, handling potential extra spaces
                 keywords_list = [kw.strip() for kw in keywords_str.split(';') if kw.strip()]
                 keyword_counter.update(keywords_list)

            # --- Authors ---
            # Authors are stored as a single string, split by ';'
            authors_str = paper.get('authors', '')
            if authors_str:
                # Split robustly, handling potential extra spaces
                authors_list = [author.strip() for author in authors_str.split(';') if author.strip()]
                author_counter.update(authors_list)

            # --- Research Area ---
            research_area = paper.get('research_area')
            if research_area:
                research_area_counter[research_area] += 1

        # --- Filter counts > 1 and sort (matching client-side logic) ---
        def filter_and_sort(counter):
            # Filter items with count > 1
            filtered_items = {item: count for item, count in counter.items() if count > 1}
            # Sort by count descending, then by name ascending
            sorted_items = sorted(filtered_items.items(), key=lambda x: (-x[1], x[0]))
            # Convert back to a list of dictionaries for JSON serialization
            return [{'name': name, 'count': count} for name, count in sorted_items]

        # --- NEW CODE: Collect all non-empty 'other' features and 'model' names ---
        other_features_counter = Counter()
        model_names_counter = Counter()

        for paper in papers:
            # Get 'other' feature text
            features_other_text = paper.get('features', {}).get('other', '')
            if features_other_text and isinstance(features_other_text, str):
                # Split by semicolon if multiple features are listed, otherwise treat as one item
                # Strip whitespace and filter out empty strings after splitting
                other_features_list = [feat.strip() for feat in features_other_text.split(';') if feat.strip()]
                other_features_counter.update(other_features_list)
            # If features_other_text is not a string (e.g., None, dict), it's ignored

            # Get 'model' name text
            technique_model_text = paper.get('technique', {}).get('model', '')
            if technique_model_text and isinstance(technique_model_text, str):
                # Split by semicolon if multiple models are listed, otherwise treat as one item
                # Strip whitespace and filter out empty strings after splitting
                model_names_list = [model.strip() for model in technique_model_text.split(';') if model.strip()]
                model_names_counter.update(model_names_list)
            # If technique_model_text is not a string (e.g., None, dict), it's ignored

        # Convert Counters to lists of {'name': item, 'count': count} dictionaries
        # Include ALL items, not just repeating ones (> 1)
        def counter_to_list_all(counter):
            # Sort by count descending, then alphabetically ascending for ties
            sorted_items = sorted(counter.items(), key=lambda x: (-x[1], x[0]))
            return [{'name': name, 'count': count} for name, count in sorted_items]

        # --- END NEW CODE ---

        # --- Modified stats_data preparation ---
        stats_data = {
            # Existing repeating stats
            'journals': filter_and_sort(journal_counter),
            'keywords': filter_and_sort(keyword_counter),
            'authors': filter_and_sort(author_counter),
            'research_areas': filter_and_sort(research_area_counter),
            # NEW: All non-empty features.other and technique.model
            'other_features_all': counter_to_list_all(other_features_counter), # Changed key name for clarity
            'model_names_all': counter_to_list_all(model_names_counter)       # Changed key name for clarity
        }

        return jsonify({'status': 'success', 'data': stats_data})

    except Exception as e:
        print(f"Error calculating stats: {e}")
        return jsonify({'status': 'error', 'message': 'Failed to calculate statistics'}), 500

@app.route('/update_paper', methods=['POST'])
def update_paper():
    """Endpoint to handle AJAX updates (partial or full)."""
    data = request.get_json()
    paper_id = data.get('id')
    if not paper_id:
        return jsonify({'status': 'error', 'message': 'Paper ID is required'}), 400

    try:
        # Use 'user' as the identifier for changes made via this interface
        result = update_paper_custom_fields(paper_id, data, changed_by="user")
        # The result dict already contains status and other data
        return jsonify(result)
    except Exception as e:
        print(f"Error updating paper {paper_id}: {e}") # Log error
        return jsonify({'status': 'error', 'message': 'Failed to update database'}), 500

@app.route('/classify', methods=['POST'])
def classify_paper():
    """Endpoint to handle classification requests (single or batch)."""
    data = request.get_json()
    mode = data.get('mode', 'id') # Default to 'id' for single paper
    paper_id = data.get('paper_id')
    
    # Determine DB file (use command-line arg or global default)
    db_file = DATABASE 

    def run_classification_task():
        """Background task to run classification."""
        try:
            print(f"Starting classification task: mode={mode}, paper_id={paper_id}")
            # Call the appropriate function from automate_classification
            # Pass db_file explicitly or rely on its internal defaults/globals
            automate_classification.run_classification(
                mode=mode,
                paper_id=paper_id,
                db_file=db_file
                # grammar_file=..., prompt_template=..., server_url=... # Use defaults or override if needed
            )
            print(f"Classification task completed: mode={mode}, paper_id={paper_id}")
        except Exception as e:
            print(f"Error during background classification (mode={mode}, paper_id={paper_id}): {e}")
            # Consider logging this error more formally

    if mode in ['all', 'remaining']:
        # Run batch classification in a background thread to avoid blocking
        thread = threading.Thread(target=run_classification_task)
        thread.daemon = True # Dies with main process
        thread.start()
        # Return immediately
        return jsonify({'status': 'started', 'message': f'Batch classification ({mode}) initiated.'})
    elif mode == 'id' and paper_id:
        try:
            # Run single paper classification synchronously
            # The function updates the DB directly
            automate_classification.run_classification(
                mode=mode,
                paper_id=paper_id,
                db_file=db_file
            )
            # Fetch the updated data from the database
            updated_data = fetch_updated_paper_data(paper_id)
            if updated_data['status'] == 'success':
                return jsonify(updated_data)
            else:
                return jsonify(updated_data), 404 # Or 500 if it's a server error fetching data
        except Exception as e:
            print(f"Error classifying paper {paper_id}: {e}")
            return jsonify({'status': 'error', 'message': f'Classification failed: {str(e)}'}), 500
    else:
        return jsonify({'status': 'error', 'message': 'Invalid mode or missing paper_id for single classification.'}), 400

@app.route('/verify', methods=['POST'])
def verify_paper():
    """Endpoint to handle verification requests (single or batch)."""
    data = request.get_json()
    mode = data.get('mode', 'id') # Default to 'id' for single paper
    paper_id = data.get('paper_id')
    
    # Determine DB file (use command-line arg or global default)
    db_file = DATABASE

    def run_verification_task():
        """Background task to run verification."""
        try:
            print(f"Starting verification task: mode={mode}, paper_id={paper_id}")
            # Call the appropriate function from verify_classification
            verify_classification.run_verification(
                mode=mode,
                paper_id=paper_id,
                db_file=db_file
            )
            print(f"Verification task completed: mode={mode}, paper_id={paper_id}")
        except Exception as e:
            print(f"Error during background verification (mode={mode}, paper_id={paper_id}): {e}")
            # Consider logging this error more formally

    if mode in ['all', 'remaining']:
        # Run batch verification in a background thread to avoid blocking
        thread = threading.Thread(target=run_verification_task)
        thread.daemon = True
        thread.start()
        # Return immediately
        return jsonify({'status': 'started', 'message': f'Batch verification ({mode}) initiated.'})
    elif mode == 'id' and paper_id:
        try:
            # Run single paper verification synchronously
            verify_classification.run_verification(
                mode=mode,
                paper_id=paper_id,
                db_file=db_file
            )
            # Fetch the updated data from the database
            updated_data = fetch_updated_paper_data(paper_id)
            if updated_data['status'] == 'success':
                return jsonify(updated_data)
            else:
                return jsonify(updated_data), 404 # Or 500
        except Exception as e:
            print(f"Error verifying paper {paper_id}: {e}")
            return jsonify({'status': 'error', 'message': f'Verification failed: {str(e)}'}), 500
    else:
        return jsonify({'status': 'error', 'message': 'Invalid mode or missing paper_id for single verification.'}), 400

@app.route('/upload_bibtex', methods=['POST'])
def upload_bibtex():
    """Endpoint to handle BibTeX file upload and import."""
    global DATABASE # Assuming DATABASE is defined globally as before

    if 'file' not in request.files:
        return jsonify({'status': 'error', 'message': 'No file part'}), 400

    file = request.files['file']

    if file.filename == '':
        return jsonify({'status': 'error', 'message': 'No selected file'}), 400

    if file and file.filename.lower().endswith('.bib'):
        try:
            # Save the uploaded file to a temporary location
            with tempfile.NamedTemporaryFile(delete=False, suffix='.bib') as tmp_bib_file:
                file.save(tmp_bib_file.name)
                tmp_bib_path = tmp_bib_file.name

            # Use the existing import_bibtex logic
            # Import here to avoid potential circular imports if placed at the top
            import import_bibtex 

            # Call the import function with the temporary file and the global DB path
            import_bibtex.import_bibtex(tmp_bib_path, DATABASE)

            # Clean up the temporary file
            os.unlink(tmp_bib_path)

            return jsonify({'status': 'success', 'message': 'BibTeX file imported successfully.'})

        except Exception as e:
            # Ensure cleanup even if import fails
            if 'tmp_bib_path' in locals():
                try:
                    os.unlink(tmp_bib_path)
                except OSError:
                    pass # Ignore errors during cleanup
            print(f"Error importing BibTeX: {e}")
            return jsonify({'status': 'error', 'message': f'Import failed: {str(e)}'}), 500
    else:
        return jsonify({'status': 'error', 'message': 'Invalid file type. Please upload a .bib file.'}), 400


import textwrap # Import at the top of your file if not already present

# --- Add this new route function ---

@app.route('/citation_export', methods=['GET'])
def export_citations():
    """Generate and serve a downloadable text file of citations based on current filters."""
    # --- 1. Get filter parameters (same as other exports) ---
    hide_offtopic_param = request.args.get('hide_offtopic')
    year_from_param = request.args.get('year_from')
    year_to_param = request.args.get('year_to')
    min_page_count_param = request.args.get('min_page_count')
    search_query_param = request.args.get('search_query')

    # --- 2. Apply default values and parse filters (same as other exports) ---
    hide_offtopic = True
    if hide_offtopic_param is not None:
        hide_offtopic = hide_offtopic_param.lower() in ['1', 'true', 'yes', 'on']
    year_from_value = int(year_from_param) if year_from_param is not None else DEFAULT_YEAR_FROM
    year_to_value = int(year_to_param) if year_to_param is not None else DEFAULT_YEAR_TO
    min_page_count_value = int(min_page_count_param) if min_page_count_param is not None else DEFAULT_MIN_PAGE_COUNT
    search_query_value = search_query_param if search_query_param is not None else ""

    # --- 3. Fetch papers based on filters ---
    papers = fetch_papers(
        hide_offtopic=hide_offtopic,
        year_from=year_from_value,
        year_to=year_to_value,
        min_page_count=min_page_count_value,
        search_query=search_query_value
    )

    # --- 4. Format citations ---
    citation_lines = []
    for paper in papers:
        # Example: Simple APA-like text format (Adapt as needed)
        # Format: Authors (Year). Title. Journal, Volume, Pages. DOI
        try:
            authors = paper.get('authors', '').strip()
            if not authors:
                 authors_list = ["(Unknown Author)"]
            else:
                 # Basic cleanup, consider more robust parsing if needed
                 authors_list = [author.strip() for author in authors.split(';') if author.strip()]
            
            # Truncate author list for display if very long, or handle "et al." if already present
            if len(authors_list) > 5: # Example truncation
                formatted_authors = ", ".join(authors_list[:3]) + " et al."
            else:
                formatted_authors = ", ".join(authors_list[:-1]) + " & " + authors_list[-1] if len(authors_list) > 1 else authors_list[0]

            title = paper.get('title', 'N.p.').strip()
            year = paper.get('year', 'N.d.')
            journal = paper.get('journal', 'N.p.').strip() # N.p. = No publisher/part
            volume = paper.get('volume', '').strip()
            pages = paper.get('pages', '').strip()
            doi = paper.get('doi', '').strip()

            # Build citation string
            citation_parts = [f"{formatted_authors} ({year})."]
            if title:
                citation_parts.append(f"{title}.")
            if journal:
                vol_page_info = journal
                if volume:
                    vol_page_info += f", {volume}"
                if pages:
                    vol_page_info += f", {pages}"
                citation_parts.append(f"{vol_page_info}.")
            if doi:
                citation_parts.append(f"DOI: {doi}")

            # Join parts and handle potential line wrapping for long titles/etc.
            full_citation = " ".join(citation_parts)
            # Optional: wrap long lines (e.g., at 80 chars)
            # wrapped_citation = "\n".join(textwrap.wrap(full_citation, width=80))
            citation_lines.append(full_citation) # Use wrapped_citation if you uncommented the line above
            citation_lines.append("") # Add an empty line between citations

        except Exception as e:
            # Handle potential errors in formatting a specific paper
            print(f"Warning: Error formatting citation for paper ID {paper.get('id', 'Unknown')}: {e}")
            # citation_lines.append(f"Error formatting citation for paper ID {paper.get('id', 'Unknown')}")
            citation_lines.append("")

    # Join all citations into one string
    citations_text = "\n".join(citation_lines)

    # --- 5. Prepare filename based on filters (same as other exports) ---
    filename_parts = ["ResearchParça_Citations"]
    if year_from_value == year_to_value:
        filename_parts.append(str(year_from_value))
    else:
        filename_parts.append(f"{year_from_value}-{year_to_value}")
    if min_page_count_value > 0:
        filename_parts.append(f"min{min_page_count_value}pg")
    if hide_offtopic:
        filename_parts.append("noOfftopic")
    if search_query_value:
        safe_search = "".join(c for c in search_query_value if c.isalnum() or c in (' ', '-', '_')).rstrip()
        if safe_search:
            filename_parts.append(f"search_{safe_search[:20]}")
    filename = "_".join(filename_parts) + ".txt"

    # --- 6. Return as downloadable file ---
    from flask import Response
    return Response(
        citations_text,
        mimetype="text/plain", # Or "application/x-bibtex" if exporting BibTeX
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

# --- End of new route function 


# --- Jinja2-like filters ---
def render_status(value):
    """Render status value as emoji/symbol"""
    if value == 1 or value == "true" or value is True:
        return '✔️' # Checkmark for True
    elif value == 0  or value == "false" or value is False:
        return '❌' # Cross for False
    else: # None or unknown
        return '❔' # Question mark for Unknown/Null

def render_verified_by(value):
    """
    Render verified_by value as emoji.
    Accepts the raw database value.
    Returns HTML string with emoji and tooltip if needed.
    """
    if value == 'user':
        return f'<span title="User">👤</span>' # Human emoji
    elif value is None or value == '':
        return f'<span title="Unverified">❔</span>'
    else:
        # For any other string, value is a model name, show computer emoji with tooltip
        # Escape the model name for HTML attribute safety
        escaped_model_name = str(value).replace('"', '&quot;').replace("'", "&#39;")
        return f'<span title="{escaped_model_name}">🖥️</span>'

def render_changed_by(value):
    """
    Render changed_by value as emoji.
    Accepts the raw database value.
    Returns HTML string with emoji and tooltip if needed.
    """
    if value == 'user':
        return f'<span title="User">👤</span>' # Human emoji
    elif value is None or value == '':
        return f'<span title="Unknown">❔</span>' # Question mark for null/empty
    else:
        # For any other string, value is a model name, show computer emoji with tooltip
        escaped_model_name = str(value).replace('"', '&quot;').replace("'", "&#39;")
        return f'<span title="{escaped_model_name}">🖥️</span>'

@app.template_filter('render_changed_by')
def render_changed_by_filter(value):
    # Use Markup to tell Jinja2 that the output is safe HTML
    return Markup(render_changed_by(value))

@app.template_filter('render_status')
def render_status_filter(value):
    return render_status(value)

@app.template_filter('render_verified_by')
def render_verified_by_filter(value):
    # Use Markup to tell Jinja2 that the output is safe HTML
    return Markup(render_verified_by(value)) 



if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Browse and edit PCB inspection papers database.')
    parser.add_argument('db_file', nargs='?', help='SQLite database file path (optional)')
    args = parser.parse_args()
    
    # Determine which database file to use
    if args.db_file:
        DATABASE = args.db_file
    elif hasattr(globals, 'DATABASE_FILE'):
        DATABASE = globals.DATABASE_FILE
    else:
        print("Error: No database file specified and no default in globals.DATABASE_FILE")
        sys.exit(1)

    # Check if database exists before starting server
    if not os.path.exists(DATABASE):
        print(f"Error: Database file not found: {DATABASE}")
        print("Please provide a valid database file.")
        sys.exit(1)

    # Verify the database has the required tables
    try:
        conn = sqlite3.connect(DATABASE)
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='papers'")
        if not cursor.fetchone():
            print(f"Error: Database '{DATABASE}' does not contain required 'papers' table")
            sys.exit(1)
        conn.close()
    except sqlite3.Error as e:
        print(f"Error verifying database: {e}")
        sys.exit(1)

   # --- NEW: Pre-populate FTS tables on startup ---
    # This ensures they are ready before the first search request.
    # It might take a moment on the first run or with a large DB.
    try:
        print("Ensuring FTS tables are ready...")
        conn = get_db_connection() # This will trigger ensure_fts_tables
        conn.close()
        print("FTS tables are ready.")
    except Exception as e:
        print(f"Warning: Could not pre-populate FTS tables on startup: {e}")
        # Decide if you want to continue or exit based on requirements
        # For now, let's continue, search might be slow or use fallback
        # sys.exit(1) # Uncomment if FTS is mandatory

    print(f"Starting server, database: {DATABASE}")

    # --- CORRECTED: Open browser only once ---
    # The standard Flask/Werkzeug reloader runs the script twice:
    # 1. Once in the parent process (to manage the reloader)
    # 2. Once in the child process (the actual server, where WERKZEUG_RUN_MAIN is set)
    # We only want to open the browser in the child process.

    #WTF, still loads twice when reloading on save. 
    import os
    if os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
        # Function to open the browser after a delay
        def open_browser():
            import time
            time.sleep(2)  # Wait for the server to start
            webbrowser.open("http://127.0.0.1:5000")

        # Start the browser opener in a separate thread
        threading.Thread(target=open_browser, daemon=True).start()
        print(" * Visit http://127.0.0.1:5000 to view the table.")
    # --- END CORRECTED ---
    
    # Ensure the templates and static folders exist
    if not os.path.exists('templates'):
        os.makedirs('templates')
    if not os.path.exists('static'):
        os.makedirs('static')
    app.run(host='0.0.0.0', port=5000, debug=True)
```

```python
# flatten.py
#!/usr/bin/env python3
"""
Flatten a source code folder into a single markdown file with syntax highlighting.
"""

import os
import sys
import mimetypes
from pathlib import Path

# Maximum file size in bytes (100KB = 100 * 1024 bytes)
MAX_FILE_SIZE = 64 * 1024 

def get_language_extension(file_path):
    """
    Determine the appropriate markdown language identifier for syntax highlighting.
    """
    # Common file extensions and their corresponding markdown language identifiers
    language_map = {
        '.py': 'python',
        '.js': 'javascript',
        '.ts': 'typescript',
        '.jsx': 'jsx',
        '.tsx': 'tsx',
        '.html': 'html',
        '.htm': 'html',
        '.css': 'css',
        '.json': 'json',
        '.yaml': 'yaml',
        '.yml': 'yaml',
        '.xml': 'xml',
        '.sql': 'sql',
        '.sh': 'bash',
        '.bash': 'bash',
        '.zsh': 'bash',
        '.rb': 'ruby',
        '.php': 'php',
        '.java': 'java',
        '.cpp': 'cpp',
        '.c': 'c',
        '.h': 'c',
        '.hpp': 'cpp',
        '.go': 'go',
        '.rs': 'rust',
        '.swift': 'swift',
        '.kt': 'kotlin',
        '.kts': 'kotlin',
        '.scala': 'scala',
        '.sc': 'scala',
        '.pl': 'perl',
        '.pm': 'perl',
        '.r': 'r',
        '.jl': 'julia',
        '.lua': 'lua',
        '.dart': 'dart',
        '.ex': 'elixir',
        '.exs': 'elixir',
        '.erl': 'erlang',
        '.hrl': 'erlang',
        '.clj': 'clojure',
        '.cljs': 'clojurescript',
        '.coffee': 'coffeescript',
        '.ls': 'livescript',
        '.md': 'markdown',
        '.txt': 'text',
        '.log': 'text',
        '.ini': 'ini',
        '.toml': 'toml',
        '.dockerfile': 'dockerfile',
        '.gitignore': 'gitignore',
        '.env': 'env',
    }
    
    ext = Path(file_path).suffix.lower()
    return language_map.get(ext, 'text')  # Default to 'text' if unknown

def is_binary_file(file_path):
    """
    Check if a file is binary by attempting to read it as text.
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            f.read(1024)  # Read first 1KB to check
        return False
    except UnicodeDecodeError:
        return True
    except Exception:
        # If there's any error reading the file, assume it's binary
        return True

def should_ignore_file(file_path):
    """
    Check if a file should be ignored based on common patterns.
    """
    path = Path(file_path)
    file_name = path.name.lower()
    
    # Common files and directories to ignore
    ignore_patterns = [
        '__pycache__',
        '.git',
        '.svn',
        '.hg',
        '.DS_Store',
        '.idea',
        '.vscode',
        '.venv',
        'node_modules',
        '.next',
        '.nuxt',
        'dist',
        'build',
        'target',
        '.gradle',
        '.cargo',
        'Pods',
        '.pytest_cache',
        '__pycache__',
        '*.pyc',
        '*.pyo',
        '*.so',
        '*.dll',
        '*.exe',
        '*.bin',
        '*.zip',
        '*.tar',
        '*.gz',
        '*.rar',
        '*.7z',
        '*.pdf',
        '*.jpg',
        '*.jpeg',
        '*.png',
        '*.gif',
        '*.bmp',
        '*.ico',
        '*.svg',
        '*.mp3',
        '*.mp4',
        '*.avi',
        '*.mov',
        '*.wav',
        '*.woff',
        '*.woff2',
        '*.ttf',
        '*.eot',
        '*.pptx',
        '*.xlsx',
        '*.docx',
        '*.docx',
        '*.min.js'
    ]
    
    # Check if the file/directory name matches any ignore pattern
    for pattern in ignore_patterns:
        if pattern.startswith('*'):
            # It's a file extension pattern
            if path.suffix.lower() == pattern[1:]:
                return True
        elif file_name == pattern:
            return True
        elif pattern in str(path):
            return True
    
    return False

def is_file_too_large(file_path, max_size=MAX_FILE_SIZE):
    """
    Check if a file exceeds the maximum allowed size.
    """
    try:
        file_size = os.path.getsize(file_path)
        return file_size > max_size
    except OSError:
        # If we can't get the file size, assume it's too large
        return True

def flatten_folder(source_dir, output_file, max_file_size=MAX_FILE_SIZE):
    """
    Flatten a source code folder into a single markdown file.
    """
    source_path = Path(source_dir)
    
    if not source_path.exists():
        print(f"Error: Source directory '{source_dir}' does not exist.")
        return
    
    if not source_path.is_dir():
        print(f"Error: '{source_dir}' is not a directory.")
        return
    
    with open(output_file, 'w', encoding='utf-8') as out_file:
        # Walk through all subdirectories
        for root, dirs, files in os.walk(source_path):
            # Remove ignored directories from the walk
            dirs[:] = [d for d in dirs if not should_ignore_file(os.path.join(root, d))]
            
            for file in files:
                file_path = os.path.join(root, file)
                
                # Skip if file should be ignored
                if should_ignore_file(file_path):
                    continue
                
                # Skip if file is too large
                if is_file_too_large(file_path, max_file_size):
                    print(f"Skipping large file (> {max_file_size/1024:.0f}KB): {file_path}")
                    continue
                
                # Skip binary files
                if is_binary_file(file_path):
                    print(f"Skipping binary file: {file_path}")
                    continue
                
                # Get relative path from source directory
                rel_path = os.path.relpath(file_path, source_path)
                
                # Determine language for syntax highlighting
                language = get_language_extension(file_path)
                
                # Write file header with markdown code block
                out_file.write(f"```{language}\n")
                out_file.write(f"# {rel_path}\n")
                
                # Read and write file content
                try:
                    with open(file_path, 'r', encoding='utf-8') as src_file:
                        content = src_file.read()
                        out_file.write(content)
                        
                        # Ensure file ends with a newline
                        if content and not content.endswith('\n'):
                            out_file.write('\n')
                except Exception as e:
                    print(f"Error reading file {file_path}: {e}")
                
                # Close the markdown code block
                out_file.write("```\n\n")
                
                print(f"Processed: {rel_path}")
    
    print(f"\nFlattened source code written to: {output_file}")
    print(f"Maximum file size: {max_file_size/1024:.0f}KB")

def main():
    if len(sys.argv) < 3:
        print("Usage: python flatten_code.py <source_directory> <output_file> [max_file_size_kb]")
        print("Example: python flatten_code.py ./my_project project_flat.txt 100")
        print("Default max file size: 100KB")
        sys.exit(1)
    
    source_dir = sys.argv[1]
    output_file = sys.argv[2]
    
    # Parse optional max file size argument (in KB)
    max_file_size_kb = 100  # default to 100KB
    if len(sys.argv) > 3:
        try:
            max_file_size_kb = int(sys.argv[3])
        except ValueError:
            print("Error: max_file_size_kb must be a valid integer")
            sys.exit(1)
    
    max_file_size_bytes = max_file_size_kb * 1024
    
    flatten_folder(source_dir, output_file, max_file_size_bytes)

if __name__ == "__main__":
    main()
```

```python
# globals.py
# globals.py
# **** This *has to be updated* when features or techniques change 
# See DEFAULT_FEATURES and DEFAULT_TECHNIQUE below. ****

import requests
import json
import sqlite3

import threading
import os

LLM_SERVER_URL = "http://localhost:8080"

MAX_CONCURRENT_WORKERS = 8 # Match your server slots
DATABASE_FILE = "new.sqlite"
GRAMMAR_FILE = "" #"output.gbnf" # obsolete, disabled for reasoning models.
PROMPT_TEMPLATE = "prompt_template.txt"
VERIFIER_TEMPLATE = "verifier_template.txt"

# Define default JSON structures for features and technique
DEFAULT_FEATURES = {
    "tracks": None,
    "holes": None,
    "solder_insufficient": None,
    "solder_excess": None,
    "solder_void": None,
    "solder_crack": None,
    "orientation": None,
    "wrong_component": None,
    "missing_component": None,
    "cosmetic": None,
    "other": None   #text
}

DEFAULT_TECHNIQUE = {
    "classic_cv_based": None,
    "ml_traditional": None,
    "dl_cnn_classifier": None,
    "dl_cnn_detector": None,
    "dl_rcnn_detector": None,
    "dl_transformer": None,
    "dl_other": None,
    "hybrid": None,
    "model": None,   #text
    "available_dataset": None   #text
}

# mover para client-side?
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

# --- Global Shutdown Flag for Instant Shutdown (using Lock for atomicity) ---
# This provides a common mechanism for scripts to handle Ctrl+C gracefully.
shutdown_lock = threading.Lock()
shutdown_flag = False

def set_shutdown_flag():
    """Sets the global shutdown flag to True in a thread-safe manner."""
    global shutdown_flag
    with shutdown_lock:
        shutdown_flag = True

def is_shutdown_flag_set():
    """Checks the global shutdown flag in a thread-safe manner."""
    global shutdown_flag
    with shutdown_lock:
        return shutdown_flag

def signal_handler(sig, frame):
    """Standard signal handler for SIGINT (Ctrl+C). Sets shutdown flag and forces exit."""
    print("\nReceived Ctrl+C. Killing all threads...")
    set_shutdown_flag()
    # Use os._exit for immediate shutdown across all threads
    os._exit(1)
    
#usados por automate and verify:
def get_model_alias(server_url_base):
    """Fetches the model alias from the LLM server's /v1/models endpoint."""
    models_url = f"{server_url_base.rstrip('/')}/v1/models"
    headers = {"Content-Type": "application/json"}

    try:
        response = requests.get(models_url, headers=headers, timeout=30)
        response.raise_for_status()
        models_data = response.json()

        # Simplified model alias detection
        if models_data and isinstance(models_data.get('data'), list) and models_data['data']:
            model_alias = models_data['data'][0].get('id')
            if model_alias:
                print(f"Detected model alias: '{model_alias}'")
                return model_alias

    except requests.exceptions.RequestException as e:
        print(f"Error connecting to LLM server: {e}")
        if hasattr(e, 'response') and e.response:
            print(f"Response Text: {e.response.text}")
    except json.JSONDecodeError as e:
        print(f"Error decoding JSON response: {e}")
        if 'response' in locals():
            print(f"Response Text: {response.text}")

    fallback_alias = "Unknown_LLM"
    print(f"Using fallback model alias: '{fallback_alias}'")
    return fallback_alias

def load_prompt_template(template_path):
    """Loads the prompt template from a file."""
    try:
        with open(template_path, 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        print(f"Error: Prompt template file '{template_path}' not found.")
        raise
    except Exception as e:
        print(f"Error reading prompt template file '{template_path}': {e}")
        raise


def get_paper_by_id(db_path, paper_id):
    """Fetches a single paper's data from the database by its ID."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM papers WHERE id = ?", (paper_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def load_grammar(grammar_path):
    """Loads the GBNF grammar from a file."""
    try:
        with open(grammar_path, 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        print(f"Error: Grammar file '{grammar_path}' not found.")
        raise
    except Exception as e:
        print(f"Error reading grammar file '{grammar_path}': {e}")
        raise

def send_prompt_to_llm(prompt_text, grammar_text=None, server_url_base=None, model_name="default", is_verification=False):
    """
    Sends a prompt to the LLM via the OpenAI-compatible API. 
    Returns (content_str, model_name_used, reasoning_trace).
    """
    if server_url_base is None:
        server_url_base = LLM_SERVER_URL  # Now this will work
    
    chat_url = f"{server_url_base.rstrip('/')}/v1/chat/completions"
    headers = {"Content-Type": "application/json"}
    payload = { #official recommended parameters from Qwen:
        "model": model_name,
        "messages": [{"role": "user", "content": prompt_text}],
        "temperature": 0.6,
        "top_p": 0.95, 
        "top_k": 20, 
        "min_p": 0,
        "max_tokens": 32768,
        "stream": False
    }
    if grammar_text:
        payload["grammar"] = grammar_text
    
    context = "verification " if is_verification else ""
    
    try:
        if is_shutdown_flag_set():
            return None, None, None
        response = requests.post(chat_url, headers=headers, json=payload, timeout=600)
        if is_shutdown_flag_set():
            return None, None, None
        response.raise_for_status()
        response_data = response.json()
        
        model_name_from_response = response_data.get('model', model_name)
        if 'choices' in response_data and response_data['choices']:
            # Extract reasoning_content safely
            reasoning_content = None
            message = response_data['choices'][0]['message']
            if 'reasoning_content' in message:
                reasoning_content = message.get('reasoning_content', '').strip()
            content = message.get('content', '').strip()
            return content, model_name_from_response, reasoning_content
        else:
            print(f"Warning: Unexpected LLM {context}response structure: {response_data}")
            return None, model_name_from_response, None
    except requests.exceptions.RequestException as e:
        if is_shutdown_flag_set():
            return None, None, None
        print(f"Error sending {context}request to LLM server: {e}")
        if hasattr(e, 'response') and e.response:
            print(f"Response Text: {e.response.text}")
        return None, None, None
    except json.JSONDecodeError as e:
        print(f"Error decoding JSON {context}response: {e}")
        if 'response' in locals():
            print(f"Response Text: {response.text}")
        return None, None, None
    except KeyError as e:
        print(f"Unexpected {context}response structure, missing key: {e}")
        print(f"Response Data: {response_data}")
        return None, None, None
```

```python
# import_bibtex.py
# import_bibtex.py
# This should be agnostic to changes inside features and techniques:
import sqlite3
import json
import bibtexparser
from bibtexparser.bparser import BibTexParser
from bibtexparser.customization import homogenize_latex_encoding
import argparse
import re # Import regex for brace removal

import globals

def create_database(db_path):
    """Create SQLite database with the specified schema including new columns"""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS papers (
        id TEXT PRIMARY KEY,               -- BibTeX key
        type TEXT,                         -- Publication type (article, inproceedings, etc.)
        title TEXT,
        authors TEXT,                      -- Semicolon-separated list
        year INTEGER,
        month TEXT,
        journal TEXT,                      -- Journal or conference name
        volume TEXT,
        pages TEXT,
        page_count INTEGER,                
        doi TEXT,
        issn TEXT,
        abstract TEXT,
        keywords TEXT,                     -- Semicolon-separated list
        -- Custom classification fields
        research_area TEXT,                -- NULL = unknown
        is_offtopic INTEGER,               -- 1=true, 0=false, NULL=unknown
        relevance INTEGER,                 -- New field: 0 for offtopic, 10 for ontopic
        is_survey INTEGER,                 -- 1=true, 0=false, NULL=unknown
        is_through_hole INTEGER,           -- 1=true, 0=false, NULL=unknown
        is_smt INTEGER,                    -- 1=true, 0=false, NULL=unknown
        is_x_ray INTEGER,                  -- 1=true, 0=false, NULL=unknown
        -- Features and techniques (stored as JSON)
        features TEXT,
        technique TEXT,
        -- Audit fields
        changed TEXT,                      -- ISO 8601 timestamp, NULL if never changed
        changed_by TEXT,                   -- Identifier of the changer (e.g., 'Web app')
        verified INTEGER,                  -- 1=true, 0=false, NULL=unknown
        estimated_score INTEGER,
        verified_by TEXT,                  -- Identifier of the verifier (e.g., 'user')
        reasoning_trace TEXT,              -- New column to store evaluator reasoning traces
        verifier_trace TEXT,                -- New column to store verifier reasoning traces
        user_trace TEXT                     -- User comments.
    )
    ''')
    # Enable WAL mode for better concurrency (optional)
    cursor.execute('PRAGMA journal_mode = WAL')
    conn.commit()
    conn.close() # Close connection after creation

def migrate_database(db_path):
    """Migrate existing database from old format to new format"""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Check if relevance column exists
    cursor.execute("PRAGMA table_info(papers)")
    columns = [column[1] for column in cursor.fetchall()]
    
    if 'relevance' not in columns:
        print("Migrating database to new format...")
        # Add the new relevance column
        cursor.execute("ALTER TABLE papers ADD COLUMN relevance INTEGER")
        
        # Update existing records: set relevance based on is_offtopic
        # For offtopic (is_offtopic=1), set relevance=0
        # For ontopic (is_offtopic=0), set relevance=10
        # For unknown (is_offtopic=NULL), set relevance=NULL
        cursor.execute("""
            UPDATE papers 
            SET relevance = CASE 
                WHEN is_offtopic = 1 THEN 0
                WHEN is_offtopic = 0 THEN 10
                ELSE NULL
            END
        """)
        
        conn.commit()
        print("Database migration completed.")
    
    conn.close()

def parse_authors(authors_str):
    """Parse authors string into semicolon-separated list"""
    if not authors_str:
        return ""
    # Handle potential LaTeX encoding issues if not fully homogenized
    return "; ".join(a.strip() for a in authors_str.split(' and '))

def parse_keywords(keywords_str):
    """Parse keywords into semicolon-separated list"""
    if not keywords_str:
        return ""
    return "; ".join(k.strip() for k in keywords_str.split(','))

def clean_latex_braces(text):
    """Remove unescaped curly braces from text, often left in titles by bibtexparser."""
    if not text:
        return text
    # Remove braces that are not part of a LaTeX command (simple heuristic)
    # This removes { and } that are not preceded by a backslash.
    # It might not be perfect for all edge cases but handles common ones.
    cleaned = re.sub(r'(?<!\\)\{', '', text)
    cleaned = re.sub(r'(?<!\\)\}', '', cleaned)
    return cleaned

def clean_latex_commands(text):
    """Remove common LaTeX commands and formatting from text."""
    if not text:
        return text
    
    # Remove unescaped braces
    text = re.sub(r'(?<!\\)\{', '', text)
    text = re.sub(r'(?<!\\)\}', '', text)
    
    # Replace LaTeX dash commands with regular dash
    text = re.sub(r'\\textendash', '-', text)
    text = re.sub(r'\\textemdash', '-', text)
    text = re.sub(r'\\endash', '-', text)
    text = re.sub(r'\\emdash', '-', text)
    
    # Remove other common LaTeX commands
    text = re.sub(r'\\textellipsis', '...', text)
    text = re.sub(r'\\ldots', '...', text)
    text = re.sub(r'\\dots', '...', text)
    
    # Remove any remaining LaTeX commands (pattern: backslash followed by letters)
    text = re.sub(r'\\[a-zA-Z]+', '', text)
    
    # Clean up extra whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    
    return text

def parse_pages(pages_str):
    """
    Normalize pages string to "start - end" format and return start, end, and count.
    Handles formats like '276--279', '276-279', '276', '276+', etc.
    Returns:
        tuple: (normalized_pages_str, page_count) or (None, None)
    """
    if not pages_str:
        return None, None

    # Clean LaTeX commands first
    pages_str = clean_latex_commands(pages_str).strip()

    # Match common formats including double hyphens
    # Covers: "123--456", "123-456", "123–456", "123—456"
    match = re.match(r'^(\d+)\s*[-–—]*\s*(\d+)?$', pages_str.replace('--', '-'))
    if match:
        start_page = int(match.group(1))
        end_page = int(match.group(2)) if match.group(2) else start_page
        normalized = f"{start_page} - {end_page}"
        count = end_page - start_page + 1
        return normalized, count
    else:
        # Handle "123+" format
        if re.match(r'^\d+\+$', pages_str):
            page = int(pages_str[:-1])
            return f"{page} - {page}", 1
        elif pages_str.isdigit():
            # Single page
            page = int(pages_str)
            return f"{page} - {page}", 1
        else:
            # Fallback: return as-is if parsing fails
            return pages_str, None
        
def import_bibtex(bib_file, db_path):
    """Import BibTeX file into SQLite database"""
    # Configure BibTeX parser
    parser = BibTexParser(common_strings=True)
    parser.customization = homogenize_latex_encoding
    parser.ignore_nonstandard_types = False

    # Parse BibTeX file
    with open(bib_file, 'r', encoding='utf-8') as f:
        bib_db = bibtexparser.load(f, parser=parser)

    # Create database and migrate if needed
    create_database(db_path)
    migrate_database(db_path)
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    for entry in bib_db.entries:
        # Prepare data for insertion
        title_raw = entry.get('title', '')
        cleaned_title = clean_latex_commands(title_raw)  # Use improved cleaning

        # Handle pages and page_count
        raw_pages = entry.get('pages', '')
        normalized_pages, computed_page_count = parse_pages(raw_pages)

        # Try to get page_count from numpages field
        numpages_str = entry.get('numpages', '')
        page_count = None
        if numpages_str.isdigit():
            page_count = int(numpages_str)
        else:
            page_count = computed_page_count  # fallback to computed value

        # Set relevance based on is_offtopic (0 for offtopic, 10 for ontopic)
        is_offtopic = None  # Default to unknown
        relevance = None    # Default to unknown
        
        data = {
            'id': entry.get('ID', ''),
            'type': entry.get('ENTRYTYPE', ''),
            'title': cleaned_title,
            'authors': parse_authors(entry.get('author', '')),
            'year': int(entry.get('year', '0')) if entry.get('year', '').isdigit() else None,
            'month': entry.get('month', ''),
            'journal': entry.get('journal', '') or entry.get('booktitle', ''),
            'volume': entry.get('volume', ''),
            'pages': normalized_pages,
            'page_count': page_count,
            'doi': entry.get('doi', ''),
            'issn': entry.get('issn', ''),
            'abstract': entry.get('abstract', ''),
            'keywords': parse_keywords(entry.get('keywords', '')),
            'research_area': None,
            'is_offtopic': is_offtopic,
            'relevance': relevance,  # New field
            'is_survey': None,
            'is_through_hole': None,
            'is_smt': None,
            'is_x_ray': None,
            'features': json.dumps(globals.DEFAULT_FEATURES),
            'technique': json.dumps(globals.DEFAULT_TECHNIQUE),
            'changed': None,
            'changed_by': None,
            'verified': None,
            'estimated_score': None,
            'verified_by': None,
            'reasoning_trace': None,  
            'verifier_trace': None,  
            'user_trace': None, 
        }
        # Check for duplicates: prioritize DOI, fallback to title + year
        doi = data['doi']
        title = data['title']
        year = data['year']

        duplicate_found = False
        
        if doi:
            cursor.execute("SELECT id FROM papers WHERE doi = ?", (doi,))
            if cursor.fetchone():
                print(f"Skipping duplicate entry with DOI '{doi}'")
                duplicate_found = True
        else:
            # Fallback: check for same title and year
            if title and year:
                cursor.execute("SELECT id FROM papers WHERE title = ? AND year = ?", (title, year))
                if cursor.fetchone():
                    print(f"Skipping duplicate entry with title '{title}' and year '{year}'")
                    duplicate_found = True

        if duplicate_found:
            continue  # Skip this entry

        # Insert into database
        try:
            cursor.execute('''
            INSERT INTO papers (
                id, type, title, authors, year, month, journal, 
                volume, pages, page_count, doi, issn, abstract, keywords,
                research_area, is_offtopic, relevance, is_survey, is_through_hole, 
                is_smt, is_x_ray, features, technique, changed, changed_by, verified, estimated_score, verified_by, reasoning_trace, verifier_trace, user_trace
            ) VALUES (
                :id, :type, :title, :authors, :year, :month, :journal, 
                :volume, :pages, :page_count, :doi, :issn, :abstract, :keywords,
                :research_area, :is_offtopic, :relevance, :is_survey, :is_through_hole, 
                :is_smt, :is_x_ray, :features, :technique, :changed, :changed_by, :verified, :estimated_score, :verified_by, :reasoning_trace, :verifier_trace, :user_trace
            )
            ''', data)
        except sqlite3.IntegrityError as e:
            print(f"Warning: Skipping duplicate ID '{data['id']}' - {e}")
        except Exception as e:
            print(f"Error inserting entry '{data['id']}': {e}")

    conn.commit()
    print(f"Imported {len(bib_db.entries)} records into database '{db_path}'")
    conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description='Convert BibTeX to SQLite database for PCB inspection papers')
    parser.add_argument('bib_file', help='Input BibTeX file path')
    parser.add_argument('db_file', help='Output SQLite database file path')
    args = parser.parse_args()
    import_bibtex(args.bib_file, args.db_file)
```

```text
# prompt_template.txt
Given the data from the specific paper at the end, fill in the following YAML structure exactly and convert it to JSON. Do not add, remove or move any fields.
Only write 'true' or 'false' if the contents given (abstract, title, keywords, etc.) make it clear that it is the case. If unsure, fill the field with null. Do not guess true or false unless there's enough evidence in the provided abstract/keywords/etc.

research_area: null   # broad area: electrical engineering, computer sciences, medical, finances, etc, can be inferred by journal or conference name as well as abstract contents.
is_offtopic: null     # We are looking for PCB automated defect detection papers (be it implementations or surveys on this specific field). Set this field to true if paper seems unrelated to *implementations of automated defect detection on electronic printed circuit boards*. If the paper talks about anything else entirely, set as offtopic. If the paper talks about defect detection in other areas instead of electronics manufacturing, it's also offtopic. When offtopic, answer null for all classification fields following this one (filling only the research area and relevance with actual contents). Only set this to false if at least one feature from the 'features' list below (including "other") can be set to true.
relevance: 7          # An integer from 0 to 10 estimating how relevant the paper is for the topic according to the description above. 0 for completely irrelevant, 10 for completely relevant. Offtopic papers should have relevance around 0 to 1, rarely 2.
is_survey: null       # true for survey/review/etc., false for implementations, new research, etc.
is_through_hole: null # true for papers that specify PTH, THT, etc., through-hole component mounting, false for papers that clearly do NOT relate to this type of component mounting, null if unclear.
is_smt: null          # true for papers that specify surface-mount component mounting (SMD, SMT), false for papers that clearly do NOT relate to this type of component mounting, null if unclear.
is_x_ray: null        # true for X-ray inspection, false for standard optical (visible light) inspection.
features:             # true, false, null for unknown/unclear. Mark as true all the types of defect which are detected by the implementation(s) described in the paper (or the surveyed papers if it's a survey). Mark as false if the paper explicitly exclude a class, otherwise keep as unknown.
	# Empty PCB issues:
    tracks: null #any track error detection: open track, short circuit, spurious copper, mouse bite, wrong trace space/width, etc.
    holes: null #for hole plating, drilling defects and any other PCB hole issues.
	
	# soldering issues:
    solder_insufficient: null # too little solder, dry joint, poor fillet
    solder_excess: null # solder ball / bridge / short between pads or leads
    solder_void: null # voids, blow-holes, pin-holes inside the joint
    solder_crack: null # fatigue cracks, fractured or “cold” joints
	
	# component issues: 
    orientation: null #for components installed in the correct place, but with wrong orientation (inverted polarity, wrong pin 1 placement, etc).
    wrong_component: null #for components installed in the wrong location, might also detect components being installed where none should be.
    missing_component: null #for detection of empty places where some component has to be installed (e.g. empty pads that aren't supposed to stay empty).
	
    # other issues:
	cosmetic: null #cosmetic defects (any manufacturing defect that does not actually affect functionality: scratches, dirt, etc.);
    other: null #"string with any other types of defect detection not specified above"

technique:                # true, false, null for unknown/unclear. Identify all techniques used (if it's an implementation), or all techniques reviewed (if it's a survey). For each single DL-based implementation, set exactly one dl_* flag to true. For surveys (or papers that make more than one implementation) there may be multiple ones:
	classic_cv_based: null  # for general pattern recognition techniques that do not leverage machine learning: true if the method is entirely rule-based or uses classical image-processing / pattern-recognition without learned parameters (histogram matching, morphological filtering, template matching, etc.). May or may not leverage optimization algorithms, like genetic, PSO, etc.

	ml_traditional: null    # true for any non-deep ML: SVM, RF, K-NN, LVQ, Boosting, etc. Does not include deep learning like CNNs or Transformers.

	dl_cnn_classifier: null # true when the only DL component is a plain CNN used as an image classifier (ResNet-50, EfficientNet-B0, VGG, …): no detection, no segmentation, no attention blocks.
	dl_cnn_detector: null   # true for single-shot detectors whose backbone is CNN (YOLOv3, YOLOv4, YOLOv5, YOLOv6, YOLOv7, YOLOv9, YOLOv10, SSD, RetinaNet, FCOS, CenterNet, etc.). Also true for otherwise single-stage CNNs with an attached Transformer module.
	dl_rcnn_detector: null  # true for two-stage (R-CNN family) or anchor-based region proposal detectors: R-CNN, Fast R-CNN, Faster R-CNN, Mask R-CNN, Cascade R-CNN, DetectoRS, Sparse R-CNN, etc.  Also true for otherwise two-stage CNNs with an attached Transformer module.
	dl_transformer: null    # true for any model whose core is attention/transformer blocks, including pure ViT, DETR, Deformable DETR, YOLOv8-seg, YOLOv12, RT-DETR, SegFormer, Swin, etc. Also, if the paper adds a transformer module to another model like a CNN, set both this and the corresponding CNN field as true.
	dl_other: null          # for any other DL architecture not covered above (e.g. pure Autoencoder, GAN, Diffusion, MLP-Mixer).

	hybrid: null            # true if the paper explicitly combines categories above (classic + DL, classic + ML, ML + DL).  If hybrid is true, also set each constituent technique to true.
	model: "name"			      # model name or comma-separated list if multiple models are used (YOLO, ResNet, DETR, etc.), null if not ML, "in-house" if unnamed ML model is developed in the paper itself.
	available_dataset: null # true if authors explicitly mention they're providing related datasets for the public, false if there's no dataset usage (e.g. for techniques not depending on a dataset) or if the dataset used is not provided to the public.

Below are some example outputs, from random papers, for structure reference only:

**Implementation using YOLO for SMT PCB inspection**

{{
  "research_area": "electrical engineering",
  "is_offtopic": false,
  "relevance": 9,
  "is_survey": false,
  "is_through_hole": false,
  "is_smt": true,
  "is_x_ray": false,
  "features": {{
    "tracks": true,
    "holes": false,
    "solder_insufficient": true,
    "solder_excess": true,
    "solder_void": null,
    "solder_crack": null,
    "orientation": true,
    "wrong_component": true,
    "missing_component": true,
    "cosmetic": true,
    "other": null
  }},
  "technique": {{
    "classic_cv_based": false,
    "ml_traditional": false,
    "dl_cnn_detector": true,
    "dl_rcnn_detector": false,
    "dl_transformer": false,
    "dl_other": false,
    "hybrid": false,
    "model": "YOLOv5",
    "available_dataset": true
  }}
}}

**Justification**:  
This paper presents an implementation of YOLOv5 applied to optical inspection of surface-mounted PCBs. It detects multiple defect types including solder bridges, missing components, and track issues. The dataset is publicly released. All relevant fields are set accordingly. Strongly on-topic with high relevance.

---
**Mid 2010s survey paper on deep learning methods for PCB defect detection**

{{
  "research_area": "computer sciences",
  "is_offtopic": false,
  "relevance": 8,
  "is_survey": true,
  "is_through_hole": null,
  "is_smt": null,
  "is_x_ray": null,
  "features": {{
    "tracks": true,
    "holes": true,
    "solder_insufficient": true,
    "solder_excess": true,
    "solder_void": true,
    "solder_crack": true,
    "orientation": null,
    "wrong_component": null,
    "missing_component": null,
    "cosmetic": false,
    "other": "via misalignment, pad lifting"
  }},
  "technique": {{
    "classic_cv_based": false,
    "ml_traditional": true,
    "dl_cnn_detector": true,
    "dl_rcnn_detector": true,
    "dl_transformer": false,
    "dl_other": false,
    "hybrid": true,
    "model": "ResNet, YOLOv3, Faster R-CNN, DETR",
    "available_dataset": null
  }}
}}

**Justification**:  
This is a comprehensive survey reviewing various techniques (ML, DL) used in PCB defect detection. It covers both SMT and through-hole (though not specified), and includes X-ray and optical methods. Since it's a survey, `is_survey = true`, and multiple techniques are marked as `true`. High relevance due to broad coverage of the target domain. It does not cover Transformer because that wasn't yet a thing at the time of the survey.

---
**X-ray based void detection in solder joints using CNN classifier**

{{
  "research_area": "electronics manufacturing",
  "is_offtopic": false,
  "relevance": 7,
  "is_survey": false,
  "is_through_hole": true,
  "is_smt": true,
  "is_x_ray": true,
  "features": {{
    "tracks": false,
    "holes": false,
    "solder_insufficient": null,
    "solder_excess": false,
    "solder_void": true,
    "solder_crack": null,
    "orientation": false,
    "wrong_component": false,
    "missing_component": false,
    "cosmetic": false,
    "other": null
  }},
  "technique": {{
    "classic_cv_based": false,
    "ml_traditional": false,
    "dl_cnn_detector": false,
    "dl_rcnn_detector": false,
    "dl_transformer": false,
    "dl_other": false,
    "hybrid": false,
    "model": "ResNet-50",
    "available_dataset": false
  }}
}}

**Justification**:  
The paper focuses specifically on detecting solder voids in BGA joints using X-ray imaging and a ResNet-50 classifier. It applies to both SMT and through-hole (implied by context). Very narrow scope but valid implementation in the target field. Relevance is moderate because it addresses only one defect type.

---
**Defect detection in textile manufacturing using computer vision**

{{
  "research_area": "materials engineering",
  "is_offtopic": true,
  "relevance": 1,
  "is_survey": null,
  "is_through_hole": null,
  "is_smt": null,
  "is_x_ray": null,
  "features": {{
    "tracks": null,
    "holes": null,
    "solder_insufficient": null,
    "solder_excess": null,
    "solder_void": null,
    "solder_crack": null,
    "orientation": null,
    "wrong_component": null,
    "missing_component": null,
    "cosmetic": null,
    "other": null
  }},
  "technique": {{
    "classic_cv_based": null,
    "ml_traditional": null,
    "dl_cnn_detector": null,
    "dl_rcnn_detector": null,
    "dl_transformer": null,
    "dl_other": null,
    "hybrid": null,
    "model": null,
    "available_dataset": null
  }}
}}

**Justification**:  
Although this paper uses computer vision and deep learning for *defect detection*, it is applied to **textile manufacturing**, not PCBs or electronics. Therefore, it's **off-topic**. `is_offtopic = true`, so all subsequent fields are `null`. The research area is correctly identified as materials engineering.

---

**Blockchain-based voting system**

{{
  "research_area": "computer sciences",
  "is_offtopic": true,
  "relevance": 0,
  "is_survey": null,
  "is_through_hole": null,
  "is_smt": null,
  "is_x_ray": null,
  "features": {{
    "tracks": null,
    "holes": null,
    "solder_insufficient": null,
    "solder_excess": null,
    "solder_void": null,
    "solder_crack": null,
    "orientation": null,
    "wrong_component": null,
    "missing_component": null,
    "cosmetic": null,
    "other": null
  }},
  "technique": {{
    "classic_cv_based": null,
    "ml_traditional": null,
    "dl_cnn_detector": null,
    "dl_rcnn_detector": null,
    "dl_transformer": null,
    "dl_other": null,
    "hybrid": null,
    "model": null,
    "available_dataset": null
  }}
}}

**Justification**:  
This paper proposes a blockchain solution for secure digital voting. There is **no mention of PCBs, defect detection, image processing, or hardware inspection**. It is **completely unrelated** to the topic. Hence, `is_offtopic = true`, all lower fields are `null`, and relevance is 0. Research area is broadly computer science, but still far off-topic.

--

Finally, below is the paper you will process. Answer accordingly:

*Title:* {title}
*Abstract:* {abstract}
*Keywords:* {keywords}
*Authors:* {authors}
*Publication Year:* {year}
*Publication Type:* {type}
*Publication Name:* {journal}

Remember, your response is not being read by a human, it goes directly to an automated parser. After thinking through the request in <think></think> tags, output only the result in JSON format in plaintext without any other tags like ```json or similar.
```

```markdown
# README.md
## bibtex-custom-parser
LLM-based analysis of abstracts from a BibTeX file. Tailor-made for PCB inspection papers, but may be used for other purposes with (fairly substantial) adaptation.

This was made to help research on PCB inspection. It allows for searching, filtering, statistics and, mainly, automatic, traceable classification and verification through natural language processing using large language models.

This is not yet fully-featured. For example, BibTeX import from the Web UI isn't implemented yet. See TODO.txt for more information. 

A read-only version for demonstration purposes can be accessed via GitHub Pages [here](https://zidrewndacht.github.io/bibtex-custom-parser). The static demo has full client-side browsing/sarching/filtering/stats functionality. It may not be updated as frequently as the actual code.

# Usage:

Install Python 3.x.
Create a venv and prepare it with requirements.txt.
Configure environment variables on `globals.py` as needed.
Set up llama-server or another OpenAI-compatible server with deepseek-style `<think>` reasoning support.
Run `browse_db.py`. This file calls the other scripts when needed.
```

```text
# TODO.txt
OK  Identify LLM by name from the API
OK  Remove bogus DOI links from papers that lack so.
OK  Change LLM endpoint URL to go to the server itself instead of /v1/chat/completions
        Ensure correct usage on all files.
OK  Use Config from file instead of requiring commandline

OK  Add column for "page count" (to filter out short papers)
OK  Add columns on DB for "verified by":         User        Computer        null
        Also add a tooltip for LLM namme
OK  Add new column to table and/or detail row:
OK      Verified by

OK  Add missing columns to table and/or detail row:
OK        Model name
OK        Page count
    
OK   Redo from scratch verification pass (LLM reads each DB line and checks if the according inferred values are sane)
OK      Use shared functions from globals.py
      
OK    Add support to reasoning models
OK        Save reasoning to DB
OK        Show reasoning in detail row

OK   Fix page count parser for Zotero exports

OK  Add client-side filters:
OK      Instant search keywords
OK            Ensure detail row still stays linked to corresponding article row
OK        Filter out short papers
OK        Filter out offtopic

OK    Add quick stats (totals at the end of the table)
OK        Also add counter of total papers and total filtered papers
OK    Remove signal handler + set_flags, etc. from automate_classification.py
OK    Change "changed by" to icon instead of model name, consistent with "verified by"
OK    Fix bogus table shading after filtering
OK    Fix model_name not showing in GUI
OK    Fix "other defects" not showing in GUI
OK    Fix "datasets" not showing in GUI
OK    Fix instances of computer_graphics instead of computer_vision
OK    Fix sort by 'verified'

OK?   Send to LLM from GUI
OK        Refactor automate, verify .py
OK        Reprocess and verify all?
OK        Reprocess remaining?
OK        Verify remaining;
OK?            Prevent verifying unprocessed papers;
OK        "Classify this paper" from detail row?
OK        "Verify this paper" from detail row?

OK    Fix automate never reaches final status, stuck at 'processed 524/524' papers after finishing.
OK        Do not search inside thinking traces (as it may think about things the given paper doesn't have, etc.)

OK        Fix css
OK        Tell the verifier that "None" is as valid as null.

OK        Finer-grained classes:
                Features:
                        Tracks (short, open, mouse bite, spur, spurious copper, wrong trace space/width)
                        Holes 
                        Missing component;
                        Wrong/misplaced component;
                        Wrong orientation/polarity of component;
                        Solder (Cold solder, bridging, excess solder, pinhole);
                        Cosmetic defects (any manufacturing defect that does not actually affect functionality: scratches, dirt, etc.);
                Techniques: 
                        Classic CV (pattern matching, manually-programmed feature analysis etc. May or may not leverage optimization algorithms, like genetic, PSO, etc.)
                        Classic ML (SVM, Random Forest, K-NN, LVQ, etc.)
                        DL: Standard CNN (classifiers: ResNet, EfficientNet, etc)
                        DL: Region-based CNN (detectors: R-CNNs, EfficientDet, most YOLO versions)
                        DL: Transformer (e.g. ViT, DETR, etc.) or mixed CNN+Transformer (e.g. YOLOv12)
                        Hybrid/Ensemble methods (including ML+DL, classic+DL, not including 'hybrids' of DL+DL)
                
OK      Fix/verify after refactor:
OK              Counters at the end of table
OK              Sort by
        
OK        Stats (calculated after filtering):
                Count of instances of each journal
                Count of instances of each keyword     
                        Multiple keywords per row
                Count of instances of each research area and count
OK              Fix CSS

OK      Read manually-set page count.

OK      Import bibTeX from GUI?
OK              Automatic Dedup by DOI?
    
        Allow discarding a paper from DB in GUI?
                Maybe not, be consistent with the search sentence

OK      Hide unclassified and off-topic server-side
OK      Add year range instead of "older than x years"

Refactor: optimizations for larger >>1000 papers dataset:

OK      Change min page count to server-side;
OK      Change year to server-side;
OK      Change search to server-side;
OK      Change detail row to lazy load;
OK      Reimplement repeated keywords, authors, areas count server-side 

OK      Reimplement full-client-side GH Pages export
                Optimize this version for speed somehow?

OK      Fix table layout dynamic widths (colgroups)
OK      Add loading spinner for table updates
        Fix ugly hide offtopic checkbox
        Add favicon

OK      Group features;
OK      Keep colors consistent across charts;
OK      Fix exported HTML charts;
OK      Show "has Other"
OK      Show "has User Comment"
OK      Add missing stats to server-side version. Can't be done client-side because detail row is lazy-loaded.
OK      Add Export to Excel to server-side implementation.

OK      Add sanity check filter: offtopic papers verified as wrong classification:
OK              Instead, just add a "only wrong classifications" filter then sort by offtopic?
                Potential max. 177 false offtopics of 11709?


OK      Fix server-side search not being capable of searching strings that are JSON keys (as they return all rows because they have the key)?
OK              Index JSON contents for fast search

        Refactor browse_db.py (too large)?
OK      Refactor filtering.js (too large): separate stats.js
        Automatically reset 'verified' after 're-classify this paper' or manual changes.

        
OK      Fix fixed-position JS columns (e.g. verifier score updating wrong column);

        Update commented&other field displays on save.

OK      Fix chart can grow but can't shrink?
OK      Add filter for feature groups (tracks/holes, solder, PCBA), all client-side;
OK      Add journal vs conference chart;

        Excel export:
                Count of misclassification suspects;
                Bubble charts about...?

        Add APA/ABNT? citation to detail pane
```

```text
# verifier_template.txt
Below is the data for a paper and its corresponding LLM-generated classification. Your job is to determine if the classification accurately reflects the information in the paper's title, abstract, and keywords.

Instructions:
1. Read the paper content carefully.
2. Compare the automated classification against the paper content.
3. Determine if the classification is a faithful representation of the paper.
4. Respond ONLY with a JSON object containing two fields:
   - `verified`: `true` if the classification is largely correct, `false` if it contains significant errors or misrepresentations, `null` if there's not enough data for a decision, you are unsure or cannot determine the accuracy.
   - `estimated_score`: An integer between 0 and 10 scoring the quality of the original classification. It represents a finer-grained score for how accurate the automated classification was compared to the actual paper data. 0 for completelly inaccurate, 10 for completely accurate, or any integer inbetween.

Example Response Format (only output the JSON):
{{
  "verified": true,
  "estimated_score": 8
}}

The plaintext below shows the requirements for the original classification you'll be verifying:

```plaintext
Given the data from the specific paper at the end, fill in the following YAML structure exactly and convert it to JSON. Do not add, remove or move any fields.
Only write 'true' or 'false' if the contents given (abstract, title, keywords, etc.) make it clear that it is the case. If unsure, fill the field with null. Do not guess true or false unless there's enough evidence in the provided abstract/keywords/etc.

research_area: null   # broad area: electrical engineering, computer sciences, medical, finances, etc, can be inferred by journal or conference name as well as abstract contents.
is_offtopic: null     # We are looking for PCB automated defect detection papers (be it implementations or surveys on this specific field). Set this field to true if paper seems unrelated to *implementations of automated defect detection on electronic printed circuit boards*. If the paper talks about anything else entirely, set as offtopic. If the paper talks about defect detection in other areas instead of electronics manufacturing, it's also offtopic. When offtopic, answer null for all classification fields following this one (filling only the research area and relevance with actual contents). Only set this to false if at least one feature from the 'features' list below (including "other") can be set to true.
relevance: 7          # An integer from 0 to 10 estimating how relevant the paper is for the topic according to the description above. 0 for completely irrelevant, 10 for completely relevant. Offtopic papers may have relevance "None", "null", or around 0 to 1, rarely 2.
is_survey: null       # true for survey/review/etc., false for implementations, new research, etc.
is_through_hole: null # true for papers that specify PTH, THT, etc., through-hole component mounting, false for papers that clearly do NOT relate to this type of component mounting, null if unclear.
is_smt: null          # true for papers that specify surface-mount component mounting (SMD, SMT), false for papers that clearly do NOT relate to this type of component mounting, null if unclear.
is_x_ray: null        # true for X-ray inspection, false for standard optical (visible light) inspection.
features:             # true, false, null for unknown/unclear. Mark as true all the types of defect which are detected by the implementation(s) described in the paper (or the surveyed papers if it's a survey). Mark as false if the paper explicitly exclude a class, otherwise keep as unknown.
	# Empty PCB issues:
    tracks: null #any track error detection: open track, short circuit, spurious copper, mouse bite, wrong trace space/width, etc.
    holes: null #for hole plating, drilling defects and any other PCB hole issues.
	
	# soldering issues:
    solder_insufficient: null # too little solder, dry joint, poor fillet
    solder_excess: null # solder ball / bridge / short between pads or leads
    solder_void: null # voids, blow-holes, pin-holes inside the joint
    solder_crack: null # fatigue cracks, fractured or “cold” joints
	
	# component issues: 
    orientation: null #for components installed in the correct place, but with wrong orientation (inverted polarity, wrong pin 1 placement, etc).
    wrong_component: null #for components installed in the wrong location, might also detect components being installed where none should be.
    missing_component: null #for detection of empty places where some component has to be installed (e.g. empty pads that aren't supposed to stay empty).
	
  # other issues:
	  cosmetic: null #cosmetic defects (any manufacturing defect that does not actually affect functionality: scratches, dirt, etc.);
    other: null #"string with any other types of defect detection not specified above"

technique:                # true, false, null for unknown/unclear. Identify all techniques used (if it's an implementation), or all techniques reviewed (if it's a survey). For each single DL-based implementation, set exactly one dl_* flag to true. For surveys (or papers that make more than one implementation) there may be multiple ones:
	classic_cv_based: null  # for general pattern recognition techniques that do not leverage machine learning: true if the method is entirely rule-based or uses classical image-processing / pattern-recognition without learned parameters (histogram matching, morphological filtering, template matching, etc.). May or may not leverage optimization algorithms, like genetic, PSO, etc.

	ml_traditional: null    # true for any non-deep ML: SVM, RF, K-NN, LVQ, Boosting, etc. Does not include deep learning like CNNs or Transformers.

	dl_cnn_classifier: null # true when the only DL component is a plain CNN used as an image classifier (ResNet-50, EfficientNet-B0, VGG, …): no detection, no segmentation, no attention blocks.
	dl_cnn_detector: null   # true for single-shot detectors whose backbone is CNN (YOLOv3, YOLOv4, YOLOv5, YOLOv6, YOLOv7, YOLOv9, YOLOv10, SSD, RetinaNet, FCOS, CenterNet, etc.).
	dl_rcnn_detector: null  # true for two-stage (R-CNN family) or anchor-based region proposal detectors: R-CNN, Fast R-CNN, Faster R-CNN, Mask R-CNN, Cascade R-CNN, DetectoRS, Sparse R-CNN, etc.
	dl_transformer: null    # true for any model whose core is attention/transformer blocks, including pure ViT, DETR, Deformable DETR, YOLOv8-seg, YOLOv12, RT-DETR, SegFormer, Swin, etc. Also, if the paper adds a transformer module to another model like a CNN, set both this and the corresponding CNN field as true.
	dl_other: null          # for any other DL architecture not covered above (e.g. pure Autoencoder, GAN, Diffusion, MLP-Mixer).

	hybrid: null            # true if the paper explicitly combines categories above (classic + DL, classic + ML, ML + DL).  If hybrid is true, also set each constituent technique to true.
	model: "name"			      # model name or comma-separated list if multiple models are used (YOLO, ResNet, DETR, etc.), null if not ML, "in-house" if unnamed ML model is developed in the paper itself.
	available_dataset: null # true if authors explicitly mention they're providing related datasets for the public, false if there's no dataset usage (e.g. for techniques not depending on a dataset) or if the dataset used is not provided to the public.
```
Please notice that the null may also have been recorded as None. Both are correct and have the same meaning for the parser.

Now, here is the Paper Content (real data) for your task:

*Title:* {title}
*Abstract:* {abstract}
*Keywords:* {keywords}
*Authors:* {authors}
*Publication Year:* {year}
*Publication Type:* {type}
*Publication Name:* {journal}

Automated Classification to Verify (inferred by a language model):

research_area: {research_area}
is_offtopic: {is_offtopic}
relevance: {relevance}
is_survey: {is_survey}
is_through_hole: {is_through_hole}
is_smt: {is_smt}
is_x_ray: {is_x_ray}
features:
{features}
technique:
{technique}

Your response is not being read by a human, it goes directly to an automated parser. After thinking through the request in <think></think> tags, output only the result in JSON format in plaintext without any other tags like ```json or similar.
```

```python
# verify_classification.py
# verify_classification.py
# This should be agnostic to changes inside features and techniques:
import sqlite3
import json
import argparse
import time
import os
from concurrent.futures import ThreadPoolExecutor
import queue
import threading
import signal
import globals  # Import for global settings and shared functions

def build_verification_prompt(paper_data, classification_data, template_content):
    """Builds the verification prompt string for a single paper using a loaded template."""
    # Prepare data for insertion into the template
    # Include original paper data
    format_data = {
        'title': paper_data.get('title', ''),
        'abstract': paper_data.get('abstract', ''),
        'keywords': paper_data.get('keywords', ''),
        'authors': paper_data.get('authors', ''),
        'year': paper_data.get('year', ''),
        'type': paper_data.get('type', ''),
        'journal': paper_data.get('journal', ''),
        'relevance': paper_data.get('relevance', ''),
    }
    
    # Include the LLM-generated classification data for verification
    # Convert complex fields (features, technique) back to JSON strings for template insertion
    classification_for_template = classification_data.copy()
    if isinstance(classification_for_template.get('features'), dict):
        classification_for_template['features'] = json.dumps(classification_for_template['features'], indent=2)
    if isinstance(classification_for_template.get('technique'), dict):
        classification_for_template['technique'] = json.dumps(classification_for_template['technique'], indent=2)
        
    # Add classification fields to format data
    format_data.update(classification_for_template)

    try:
        return template_content.format(**format_data)
    except KeyError as e:
        print(f"Error formatting verification prompt: Missing key {e} in paper/classification data or template expects it.")
        raise

def update_paper_verification(db_path, paper_id, verification_result, verified_by="LLM", reasoning_trace=None):
    """
    Updates the verification fields (verified, estimated_score, verified_by, verifier_trace)
    in the database for a specific paper.
    Does NOT update 'changed' or 'changed_by' as per requirements.
    """
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    verified = verification_result.get('verified')
    # Normalize verified value to database format (1, 0, None)
    if verified is True:
        verified_db_value = 1
    elif verified is False:
        verified_db_value = 0
    else: # None or anything else
        verified_db_value = None

    estimated_score = verification_result.get('estimated_score')
    # Ensure estimated_score is an integer within 0-100 or None
    if isinstance(estimated_score, (int, float)):
        estimated_score_db_value = max(0, min(100, int(estimated_score)))
    else:
        estimated_score_db_value = None

    # --- Prepare update fields and values ---
    update_fields = ["verified = ?", "estimated_score = ?", "verified_by = ?"]
    update_values = [verified_db_value, estimated_score_db_value, verified_by]

    # --- Add verifier_trace if provided ---
    if reasoning_trace is not None:
        update_fields.append("verifier_trace = ?")
        update_values.append(reasoning_trace)

    # --- Construct and execute the query ---
    update_query = f"UPDATE papers SET {', '.join(update_fields)} WHERE id = ?"
    update_values.append(paper_id) # Add paper_id for the WHERE clause

    try:
        cursor.execute(update_query, update_values) # Pass the combined list of values
        conn.commit()
        rows_affected = cursor.rowcount
    except Exception as e:
        print(f"[Thread-{threading.get_ident()}] Error updating verification for paper {paper_id}: {e}")
        rows_affected = 0
    finally:
        conn.close()
    return rows_affected > 0

def process_paper_verification_worker(
    db_path, 
    grammar_content, 
    verification_prompt_template_content, 
    paper_id_queue, 
    progress_lock, 
    processed_count, 
    total_papers, 
    model_alias
):
    """Worker function executed by each thread for verification."""
    while True:
        try:
            # Use timeout to periodically check for shutdown
            paper_id = paper_id_queue.get(timeout=1)
        except queue.Empty:
            # Check if we should shutdown periodically
            if globals.is_shutdown_flag_set():
                return
            continue

        # Poison pill - time to die
        if paper_id is None:
            return

        # Check for shutdown before processing
        if globals.is_shutdown_flag_set():
            return

        print(f"[Thread-{threading.get_ident()}] Verifying paper ID: {paper_id}")
        try:
            # 1. Fetch paper data and current classification from DB
            paper_data = globals.get_paper_by_id(db_path, paper_id)
            if not paper_data:
                print(f"[Thread-{threading.get_ident()}] Error: Paper {paper_id} not found in DB for verification.")
                continue

            # Prepare classification data for the prompt
            # Parse JSON fields back into dicts for the prompt builder
            classification_data = {}
            bool_fields = ['is_survey', 'is_offtopic', 'is_through_hole', 'is_smt', 'is_x_ray']
            for field in bool_fields:
                 # Convert DB integers (1,0,None) back to boolean/None for prompt clarity
                db_val = paper_data.get(field)
                if db_val == 1:
                    classification_data[field] = True
                elif db_val == 0:
                    classification_data[field] = False
                else: # None or unexpected
                    classification_data[field] = None

            classification_data['research_area'] = paper_data.get('research_area')

            # Handle JSON fields
            try:
                classification_data['features'] = json.loads(paper_data.get('features', '{}')) if paper_data.get('features') else {}
            except json.JSONDecodeError:
                classification_data['features'] = {}
                print(f"[Thread-{threading.get_ident()}] Warning: Could not parse features JSON for {paper_id}")

            try:
                classification_data['technique'] = json.loads(paper_data.get('technique', '{}')) if paper_data.get('technique') else {}
            except json.JSONDecodeError:
                classification_data['technique'] = {}
                print(f"[Thread-{threading.get_ident()}] Warning: Could not parse technique JSON for {paper_id}")

            # 2. Build the verification prompt
            prompt_text = build_verification_prompt(paper_data, classification_data, verification_prompt_template_content)
            
            if globals.is_shutdown_flag_set():
                return

            # 3. Send prompt to LLM
            json_result_str, model_name_used, reasoning_trace = globals.send_prompt_to_llm(
                prompt_text,
                grammar_text=grammar_content,
                server_url_base=globals.LLM_SERVER_URL,
                model_name=model_alias,
                is_verification=True
            )

            if globals.is_shutdown_flag_set():
                return

            # 4. Process LLM response
            if json_result_str:
                # print(f"[DEBUG] Raw LLM output for {paper_id}: {json_result_str}")
                try:
                    llm_verification_result = json.loads(json_result_str)
                    # 5. Update database with verification result
                    # Prepend model info to reasoning_trace
                    if reasoning_trace:
                        reasoning_trace = f"As verified by {model_name_used}\n\n{reasoning_trace}"
                    else:
                        reasoning_trace = f"As verified by {model_name_used}"

                    success = update_paper_verification(
                        db_path,
                        paper_id,
                        llm_verification_result,
                        verified_by=model_name_used,
                        reasoning_trace=reasoning_trace
                    )
                    if success:
                        print(f"[Thread-{threading.get_ident()}] Verified paper {paper_id} (Model: {model_name_used})")
                    else:
                        print(f"[Thread-{threading.get_ident()}] No verification changes or error for paper {paper_id}")
                except json.JSONDecodeError as e:
                    print(f"[Thread-{threading.get_ident()}] Error parsing LLM verification output for {paper_id}: {e}")
                    print(f"LLM Output: {json_result_str}")
                except Exception as e:
                    print(f"[Thread-{threading.get_ident()}] Error updating DB verification for {paper_id}: {e}")
            else:
                if not globals.is_shutdown_flag_set():
                    print(f"[Thread-{threading.get_ident()}] No LLM verification response for {paper_id}")

        except Exception as e:
            if not globals.is_shutdown_flag_set():
                print(f"[Thread-{threading.get_ident()}] Error verifying {paper_id}: {e}")
        finally:
            if globals.is_shutdown_flag_set():
                return
            with progress_lock:
                processed_count[0] += 1
                print(f"[Progress] Verified {processed_count[0]}/{total_papers} papers.")

def run_verification(mode='remaining', paper_id=None, db_file=None, grammar_file=None, prompt_template=None, server_url=None):
    """
    Runs the LLM verification process.

    Args:
        mode (str): 'all', 'remaining', or 'id'. Defaults to 'remaining'.
        paper_id (int, optional): The specific paper ID to verify (required if mode='id').
        db_file (str): Path to the SQLite database.
        grammar_file (str): Path to the GBNF grammar file.
        prompt_template (str): Path to the verification prompt template file.
        server_url (str): Base URL of the LLM server.
    """
    if db_file is None:
        db_file = globals.DATABASE_FILE
    if grammar_file is None:
        grammar_file = globals.GRAMMAR_FILE
    if prompt_template is None:
        prompt_template = globals.VERIFIER_TEMPLATE
    if server_url is None:
        server_url = globals.LLM_SERVER_URL

    if not os.path.exists(db_file):
        print(f"Error: Database file '{db_file}' not found.")
        return False

    try:
        verification_prompt_template_content = globals.load_prompt_template(prompt_template)
        print(f"Loaded verification prompt template from '{prompt_template}'")
    except Exception as e:
        print(f"Error loading verification prompt template: {e}")
        return False

    grammar_content = None
    if grammar_file:
        try:
            grammar_content = globals.load_grammar(grammar_file)
            print(f"Loaded GBNF grammar from '{grammar_file}' for verification")
        except Exception as e:
            print(f"Warning: Error reading grammar file for verification: {e}")
            grammar_content = None

    print("Fetching model alias from LLM server for verification...")
    model_alias = globals.get_model_alias(server_url)
    if not model_alias:
        print("Error: Could not determine model alias for verification. Exiting.")
        return False

    print(f"Connecting to database '{db_file}' to fetch papers for verification...")
    try:
        conn = sqlite3.connect(db_file)
        cursor = conn.cursor()
        
        if mode == 'all': #All classified papers (there's no sense in verifying classification of papers that weren't even classified)
            print("Fetching ALL classified papers for re-verification...")
            cursor.execute("SELECT id FROM papers WHERE (changed_by IS NOT NULL AND changed_by != '')")
        elif mode == 'id':
            if paper_id is None:
                print("Error: Mode 'id' requires a specific paper ID.")
                conn.close()
                return False
            print(f"Fetching specific paper ID: {paper_id} for verification...")
            cursor.execute("SELECT id FROM papers WHERE id = ?", (paper_id,))
            if not cursor.fetchone():
                 print(f"Warning: Paper ID {paper_id} not found or not classified.")
                 conn.close()
                 return True
            cursor.execute("SELECT id FROM papers WHERE id = ?", (paper_id,))
        else: # Default to 'remaining'
            print("Fetching classified but unverified papers...")
            cursor.execute("""
                SELECT id 
                FROM papers 
                WHERE (changed_by IS NOT NULL AND changed_by != '') 
                AND (verified_by IS NULL OR verified_by = '' OR verified = 'unknown' OR verified = '')
            """) #added  OR verified_by = 'unknown' to verify to manually set to ?
            
        paper_ids = [row[0] for row in cursor.fetchall()]
        conn.close()
        total_papers = len(paper_ids)
        print(f"Found {total_papers} paper(s) to verify based on mode '{mode}'.")
    except Exception as e:
        print(f"Error fetching paper IDs: {e}")
        return False

    if not paper_ids:
        print("No papers found matching the verification criteria. Nothing to process.")
        return True

    paper_id_queue = queue.Queue()
    for pid in paper_ids:
        paper_id_queue.put(pid)

    # Add poison pills for each worker thread
    for _ in range(globals.MAX_CONCURRENT_WORKERS):
        paper_id_queue.put(None)

    progress_lock = threading.Lock()
    processed_count = [0]

    print(f"Starting ThreadPoolExecutor with {globals.MAX_CONCURRENT_WORKERS} workers for verification...")
    start_time = time.time()

    try:
        with ThreadPoolExecutor(max_workers=globals.MAX_CONCURRENT_WORKERS) as executor:
            futures = []
            for _ in range(globals.MAX_CONCURRENT_WORKERS):
                future = executor.submit(
                    process_paper_verification_worker,
                    db_file,
                    grammar_content,
                    verification_prompt_template_content,
                    paper_id_queue,
                    progress_lock,
                    processed_count,
                    total_papers,
                    model_alias
                )
                futures.append(future)
            
            print("Verification processing started. Press Ctrl+C to abort.")
            
            while not globals.is_shutdown_flag_set():
                if all(f.done() for f in futures):
                    break
                time.sleep(0.1)

    except KeyboardInterrupt:
        print("\nKeyboardInterrupt caught in run_verification. Setting shutdown flag.")
        globals.set_shutdown_flag()
    except Exception as e:
        print(f"Error in main verification execution loop: {e}")
        globals.set_shutdown_flag()
    finally:
        end_time = time.time()
        final_count = 0
        if progress_lock:
            with progress_lock:
                final_count = processed_count[0] if processed_count else 0
        print(f"\n--- Verification Summary ---")
        print(f"Papers verified: {final_count}/{total_papers}")
        print(f"Time taken: {end_time - start_time:.2f} seconds")
        print("Verification run finished.")
        return not globals.is_shutdown_flag_set()
    
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Verify LLM classifications for papers in the database.')
    parser.add_argument('--mode', '-m', choices=['all', 'remaining', 'id'], default='remaining',
                        help="Verification mode: 'all' (verify all classified), 'remaining' (verify unverified), 'id' (verify a specific paper). Default: 'remaining'.")
    parser.add_argument('--paper_id', '-i', type=int, help='Paper ID to verify (required if --mode id).')
    parser.add_argument('--db_file', default=globals.DATABASE_FILE,
                       help=f'SQLite database file path (default: {globals.DATABASE_FILE})')
    parser.add_argument('--grammar_file', '-g', default=globals.GRAMMAR_FILE,
                       help=f'Path to the GBNF grammar file (default: {globals.GRAMMAR_FILE})')
    parser.add_argument('--prompt_template', '-t', default=globals.VERIFIER_TEMPLATE,
                       help=f'Path to the verification prompt template file (default: {globals.VERIFIER_TEMPLATE})')
    parser.add_argument('--server_url', default=globals.LLM_SERVER_URL,
                       help=f'Base URL of the LLM server (default: {globals.LLM_SERVER_URL})')
    args = parser.parse_args()

    signal.signal(signal.SIGINT, globals.signal_handler)

    if args.mode == 'id' and args.paper_id is None:
        parser.error("--mode 'id' requires --paper_id to be specified.")

    success = run_verification(
        mode=args.mode,
        paper_id=args.paper_id,
        db_file=args.db_file,
        grammar_file=args.grammar_file,
        prompt_template=args.prompt_template,
        server_url=args.server_url
    )

    if not success and not globals.is_shutdown_flag_set():
        exit(1)
```

```javascript
# static\comms.js
// static/comms.js
/** For detail row retrieval and functionality that writes to the server (DB updates, etc). */
// --- New Global Variables for Batch Status ---
const batchModal = document.getElementById("batchModal");
let isBatchRunning = false; // Simple flag to prevent multiple simultaneous batches

//Hardocoded cells - used for both scripts:
const typeCellIndex = 0;
const yearCellIndex = 2;
const journalCellIndex = 3;
const pageCountCellIndex = 4;
const estScoreCellIndex = 34;

// --- Status Cycling Logic ---
const STATUS_CYCLE = {
    '❔': { next: '✔️', value: 'true' },
    '✔️': { next: '❌', value: 'false' },
    '❌': { next: '❔', value: 'unknown' }
};
const VERIFIED_BY_CYCLE = {
    '👤': { next: '❔', value: 'unknown' }, 
    '❔': { next: '👤', value: 'user' },   
    // If user sees Computer (🖥️), next is Unknown (sending 'unknown' triggers server to set DB to NULL)
    // We assume the user wants to override/review it, not set it to computer.
    '🖥️': { next: '❔', value: 'unknown' } 
};
/**
 * Helper to update a cell's status symbol based on boolean/null value.
 * @param {Element} row - The main table row element.
 * @param {string} selector - The CSS selector for the cell within the row.
 * @param {*} value - The value (true, false, null, undefined) to determine the symbol.
 */
function updateRowCell(row, selector, value) {
    const cell = row.querySelector(selector);
    if (cell) {
        cell.textContent = renderStatus(value); // Use the renderStatus function
    }
}

/**
 * Renders a status value (true, false, null, etc.) as an emoji.
 * Replicates Python's render_status logic on the client.
 * @param {*} value - The value to render.
 * @returns {string} The emoji string.
 */
function renderStatus(value) {
    if (value === 1 || value === true) {
        return '✔️';
    } else if (value === 0 || value === false) {
        return '❌';
    } else {
        return '❔';
    }
}

/**
 * Renders a verified_by value (user, model_name, null) as an emoji with tooltip.
 * Replicates Python's render_verified_by logic on the client.
 * @param {*} value - The raw database value.
 * @returns {string} The HTML string for the emoji span.
 */
function renderVerifiedBy(value) {
     if (value === 'user') {
        return '<span title="User">👤</span>';
    } else if (value === null || value === undefined || value === '') {
        return '<span title="Unverified">❔</span>';
    } else {
        // Escape the model name for HTML attribute safety (basic escaping)
        let escapedModelName = String(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        return `<span title="${escapedModelName}">🖥️</span>`;
    }
}

// --- Helper function to render changed_by value as emoji (Client-Side) ---
function renderChangedBy(value) {
    // This replicates the logic from Python's render_changed_by function
    if (value === 'user') {
        return '<span title="User">👤</span>';
    } else if (value === null || value === undefined || value === '') {
        return '<span title="Unknown">❔</span>';
    } else {
        // Escape the model name for HTML attribute safety (basic escaping)
        // Using a simple replace for quotes. For more robust escaping, consider a library.
        let escapedModelName = String(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        return `<span title="${escapedModelName}">🖥️</span>`;
    }
}

function showBatchActions(){
    batchModal.offsetHeight;
    batchModal.classList.add('modal-active');
}
function closeBatchModal() { batchModal.classList.remove('modal-active'); }

document.addEventListener('DOMContentLoaded', function () {
        
    // Click Handler for Editable Status Cells
    document.addEventListener('click', function (event) {
        // Check if the clicked element is an editable status cell
        if (event.target.classList.contains('editable-status')) {
            const cell = event.target;
            const currentText = cell.textContent.trim();
            const field = cell.getAttribute('data-field');
            const row = cell.closest('tr[data-paper-id]'); // Find the parent row with the paper ID
            const paperId = row ? row.getAttribute('data-paper-id') : null;
            if (!paperId) {
                console.error('Paper ID not found for clicked cell.');
                return;
            }
            // Find the next status in the general cycle
            const nextStatusInfo = STATUS_CYCLE[currentText];
            if (!nextStatusInfo) {
                console.error('Unknown status symbol:', currentText);
                // default to unknown if symbol is unrecognized
                const defaultNextStatusInfo = STATUS_CYCLE['❔'];
                cell.textContent = defaultNextStatusInfo.next;
                // Prepare data for AJAX using the default value
                const dataToSend = {
                    id: paperId,
                    [field]: defaultNextStatusInfo.value
                };
                sendAjaxRequest(cell, dataToSend, currentText, row, paperId, field);
                return;
            }
            const nextSymbol = nextStatusInfo.next;
            const nextValue = nextStatusInfo.value;

            // 1. Immediately update the UI (for general fields)
            cell.textContent = nextSymbol;
            cell.style.backgroundColor = '#f9e79f'; // Light yellow flash
            setTimeout(() => {
                 // Ensure we only reset the background if it hasn't changed again
                 if (cell.textContent === nextSymbol) {
                     cell.style.backgroundColor = ''; // Reset to default
                 }
            }, 300);

            // 2. Prepare data for the AJAX request (for general fields)
            const dataToSend = {
                id: paperId,
                [field]: nextValue
            };
            sendAjaxRequest(cell, dataToSend, currentText, row, paperId, field);
        }
    });

    // Click Handler for Editable Verify Cell (verified_by)
    document.addEventListener('click', function (event) {
        // Find the closest .editable-verify ancestor (handles clicks on <span> inside)
        const cell = event.target.closest('.editable-verify');
        if (!cell) return; // Not a verify cell or child thereof

        const currentSpan = cell.querySelector('span');
        if (!currentSpan) return;

        const currentSymbol = currentSpan.textContent.trim();
        const field = cell.getAttribute('data-field'); // Should be "verified_by"
        const row = cell.closest('tr[data-paper-id]');
        const paperId = row ? row.getAttribute('data-paper-id') : null;

        if (!paperId) {
            console.error('Paper ID not found for clicked cell.');
            return;
        }

        const nextStatusInfo = VERIFIED_BY_CYCLE[currentSymbol];
        if (!nextStatusInfo) {
            console.error('Unknown verified_by symbol:', currentSymbol);
            return;
        }

        const nextSymbol = nextStatusInfo.next;
        const nextValue = nextStatusInfo.value; // 'user', 'unknown'

        // 1. Immediately update the UI
        if (nextValue === 'user') {
            cell.innerHTML = '<span title="User">👤</span>';
        } else {
            cell.innerHTML = '<span title="Unverified">❔</span>';
        }

        cell.style.backgroundColor = '#f9e79f'; // Light yellow flash
        setTimeout(() => {
            if (cell.querySelector('span')?.textContent.trim() === nextSymbol) {
                cell.style.backgroundColor = '';
            }
        }, 300);

        // 2. Prepare data for AJAX
        const dataToSend = {
            id: paperId,
            [field]: nextValue === 'unknown' ? null : nextValue
        };

        // 3. Send AJAX request
        sendAjaxRequest(cell, dataToSend, currentSymbol, row, paperId, field);
    });

    // --- Batch Action Button Event Listeners ---
    const parçaToolsBtn = document.getElementById('parça-tools-btn');
    const classifyAllBtn = document.getElementById('classify-all-btn');
    const classifyRemainingBtn = document.getElementById('classify-remaining-btn');
    const verifyAllBtn = document.getElementById('verify-all-btn');
    const verifyRemainingBtn = document.getElementById('verify-remaining-btn');
    const batchStatusMessage = document.getElementById('batch-status-message');

    function runBatchAction(mode, actionType) { // actionType: 'classify' or 'verify'
        if (isBatchRunning) {
            alert(`A ${actionType} batch is already running.`);
            return;
        }

        if (!confirm(`Are you sure you want to ${actionType} ${mode === 'all' ? 'ALL' : 'REMAINING'} papers? This might take a while.`)) {
            return;
        }

        isBatchRunning = true;
        const btnToDisable = mode === 'all' ? (actionType === 'classify' ? classifyAllBtn : verifyAllBtn) :
                                              (actionType === 'classify' ? classifyRemainingBtn : verifyRemainingBtn);
        const otherBtns = [classifyAllBtn, classifyRemainingBtn, verifyAllBtn, verifyRemainingBtn].filter(btn => btn !== btnToDisable);

        if (btnToDisable) btnToDisable.disabled = true;
        otherBtns.forEach(btn => btn.disabled = true);
        if (batchStatusMessage) batchStatusMessage.textContent = `Starting ${actionType} (${mode})...`;

        const endpoint = actionType === 'classify' ? '/classify' : '/verify';

        fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ mode: mode })
        })
        .then(response => {
             if (!response.ok) {
                 return response.json().then(errData => {
                     throw new Error(errData.message || `HTTP error! status: ${response.status}`);
                 }).catch(() => {
                     throw new Error(`HTTP error! status: ${response.status}`);
                 });
             }
             return response.json();
        })
        .then(data => {
            if (data.status === 'started') {
                if (batchStatusMessage) batchStatusMessage.textContent = data.message;
                // Batch started, it's running in the background.
                // To re-enable buttons after a short delay or assume user knows it's running
                //  setTimeout(() => {
                //      isBatchRunning = false; // Allow new batches after a short time
                //      if (btnToDisable) btnToDisable.disabled = false;
                //      otherBtns.forEach(btn => btn.disabled = false);
                //     //  if (batchStatusMessage) batchStatusMessage.textContent += " (Background task running)";
                //  }, 2000); // Assume it started successfully after 2s
            } else {
                 // This shouldn't happen for batch actions, but handle if it does
                 console.error(`Unexpected response for batch ${actionType}:`, data);
                 if (batchStatusMessage) batchStatusMessage.textContent = `Error initiating ${actionType} (${mode}).`;
                 isBatchRunning = false;
                 if (btnToDisable) btnToDisable.disabled = false;
                 otherBtns.forEach(btn => btn.disabled = false);
            }
        })
        .catch(error => {
            console.error(`Error initiating batch ${actionType} (${mode}):`, error);
            alert(`Failed to start ${actionType} (${mode}): ${error.message}`);
            isBatchRunning = false;
            if (btnToDisable) btnToDisable.disabled = false;
            otherBtns.forEach(btn => btn.disabled = false);
            if (batchStatusMessage) batchStatusMessage.textContent = '';
        });
    }

    parçaToolsBtn.addEventListener('click', showBatchActions);
    classifyAllBtn.addEventListener('click', () => runBatchAction('all', 'classify'));
    classifyRemainingBtn.addEventListener('click', () => runBatchAction('remaining', 'classify'));
    verifyAllBtn.addEventListener('click', () => runBatchAction('all', 'verify'));
    verifyRemainingBtn.addEventListener('click', () => runBatchAction('remaining', 'verify'));

    // --- Per-Row Action Button Event Listeners ---
    document.addEventListener('click', function(event) {
        const classifyBtn = event.target.closest('.classify-btn');
        const verifyBtn = event.target.closest('.verify-btn');

        if (classifyBtn || verifyBtn) {
            const paperId = (classifyBtn || verifyBtn).getAttribute('data-paper-id');
            const actionType = classifyBtn ? 'classify' : 'verify';
            const endpoint = classifyBtn ? '/classify' : '/verify';

            if (!paperId) {
                console.error(`Paper ID not found for ${actionType} button.`);
                return;
            }

            // Disable the button temporarily
            (classifyBtn || verifyBtn).disabled = true;
            (classifyBtn || verifyBtn).textContent = 'Running...';

            // Send AJAX request
            fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ mode: 'id', paper_id: paperId })
            })
            .then(response => {
                if (!response.ok) {
                    return response.json().then(errData => {
                         throw new Error(errData.message || `HTTP error! status: ${response.status}`);
                    }).catch(() => {
                         throw new Error(`HTTP error! status: ${response.status}`);
                    });
                }
                return response.json();
            })
            .then(data => {
                if (data.status === 'success') {
                    // Update the row with the received data
                    const row = document.querySelector(`tr[data-paper-id="${paperId}"]`);
                    const detailRow = row ? row.nextElementSibling : null;
                    if (row) {
                        // Update main row cells
                        updateRowCell(row, '.editable-status[data-field="is_offtopic"]', data.is_offtopic);
                        updateRowCell(row, '.editable-status[data-field="is_survey"]', data.is_survey);
                        updateRowCell(row, '.editable-status[data-field="is_through_hole"]', data.is_through_hole);
                        updateRowCell(row, '.editable-status[data-field="is_smt"]', data.is_smt);
                        updateRowCell(row, '.editable-status[data-field="is_x_ray"]', data.is_x_ray);

                        // Replace the existing feature updates with:
                        updateRowCell(row, '.editable-status[data-field="features_tracks"]', data.features?.tracks);
                        updateRowCell(row, '.editable-status[data-field="features_holes"]', data.features?.holes);
                        updateRowCell(row, '.editable-status[data-field="features_solder_insufficient"]', data.features?.solder_insufficient);
                        updateRowCell(row, '.editable-status[data-field="features_solder_excess"]', data.features?.solder_excess);
                        updateRowCell(row, '.editable-status[data-field="features_solder_void"]', data.features?.solder_void);
                        updateRowCell(row, '.editable-status[data-field="features_solder_crack"]', data.features?.solder_crack);
                        updateRowCell(row, '.editable-status[data-field="features_orientation"]', data.features?.orientation);
                        updateRowCell(row, '.editable-status[data-field="features_wrong_component"]', data.features?.wrong_component);
                        updateRowCell(row, '.editable-status[data-field="features_missing_component"]', data.features?.missing_component);
                        updateRowCell(row, '.editable-status[data-field="features_cosmetic"]', data.features?.cosmetic);
                        updateRowCell(row, '.editable-status[data-field="features_other"]', data.features?.other);

                        // Replace the existing technique updates with:
                        updateRowCell(row, '.editable-status[data-field="technique_classic_cv_based"]', data.technique?.classic_cv_based);
                        updateRowCell(row, '.editable-status[data-field="technique_ml_traditional"]', data.technique?.ml_traditional);
                        updateRowCell(row, '.editable-status[data-field="technique_dl_cnn_classifier"]', data.technique?.dl_cnn_classifier);
                        updateRowCell(row, '.editable-status[data-field="technique_dl_cnn_detector"]', data.technique?.dl_cnn_detector);
                        updateRowCell(row, '.editable-status[data-field="technique_dl_rcnn_detector"]', data.technique?.dl_rcnn_detector);
                        updateRowCell(row, '.editable-status[data-field="technique_dl_transformer"]', data.technique?.dl_transformer);
                        updateRowCell(row, '.editable-status[data-field="technique_dl_other"]', data.technique?.dl_other);
                        updateRowCell(row, '.editable-status[data-field="technique_hybrid"]', data.technique?.hybrid);
                        updateRowCell(row, '.editable-status[data-field="technique_available_dataset"]', data.technique?.available_dataset);

                        // Update audit/other fields
                        const changedCell = row.querySelector('.changed-cell');
                        if (changedCell) changedCell.textContent = data.changed_formatted || '';

                        const changedByCell = row.querySelector('.changed-by-cell');
                        if (changedByCell) changedByCell.innerHTML = renderChangedBy(data.changed_by);

                        const verifiedCell = row.querySelector('.editable-status[data-field="verified"]');
                        if (verifiedCell) {
                            // Assuming render_status function exists or create one
                            verifiedCell.textContent = renderStatus(data.verified);
                        }

                        const verifiedByCell = row.querySelector('.editable-verify[data-field="verified_by"]');
                        if (verifiedByCell) {
                             // Assuming render_verified_by function exists or create one based on Python logic
                             verifiedByCell.innerHTML = renderVerifiedBy(data.verified_by);
                        }
                        const estimatedScoreCell = row.cells[estScoreCellIndex];  //Updates score dynamically after verification.
                        if (estimatedScoreCell) estimatedScoreCell.textContent = data.estimated_score !== null && data.estimated_score !== undefined ? data.estimated_score : ''; // Example formatting

                        const pageCountCell = row.cells[pageCountCellIndex]; 
                        if (pageCountCell) pageCountCell.textContent = data.page_count !== null && data.page_count !== undefined ? data.page_count : '';

                        // Update detail row traces if expanded
                        if (detailRow && detailRow.classList.contains('expanded')) {
                            const evalTraceDiv = detailRow.querySelector('.detail-evaluator-trace .trace-content');
                            if (evalTraceDiv) {
                                evalTraceDiv.textContent = data.reasoning_trace || 'No trace available.';
                                evalTraceDiv.classList.remove('trace-placeholder');
                            }
                            const verifyTraceDiv = detailRow.querySelector('.detail-verifier-trace .trace-content');
                            if (verifyTraceDiv) {
                                verifyTraceDiv.textContent = data.verifier_trace || 'No trace available.';
                                verifyTraceDiv.classList.remove('trace-placeholder');
                            }
                            // Update form fields if needed (e.g., model name, other defects might have changed)
                            const form = detailRow.querySelector(`form[data-paper-id="${paperId}"]`);
                            if(form){
                                const modelNameInput = form.querySelector('input[name="technique_model"]');
                                if(modelNameInput) modelNameInput.value = data.technique?.model || '';
                                const otherDefectsInput = form.querySelector('input[name="features_other"]');
                                if(otherDefectsInput) otherDefectsInput.value = data.features?.other || '';
                                const researchAreaInput = form.querySelector('input[name="research_area"]');
                                if(researchAreaInput) researchAreaInput.value = data.research_area || '';
                                // const pageCountInput = form.querySelector('input[name="page_count"]');
                                // if(pageCountInput) pageCountInput.value = data.page_count !== null && data.page_count !== undefined ? data.page_count : '';
                                // const userTraceTextarea = form.querySelector('textarea[name="user_trace"]');
                                // if(userTraceTextarea) userTraceTextarea.value = data.user_trace || ''; // Update textarea value
                            }
                        }
                        updateCounts();
                        console.log(`${actionType.charAt(0).toUpperCase() + actionType.slice(1)} successful for paper ${paperId}`);
                    }
                } else {
                    console.error(`${actionType.charAt(0).toUpperCase() + actionType.slice(1)} error for paper ${paperId}:`, data.message);
                    alert(`Failed to ${actionType} paper ${paperId}: ${data.message}`);
                }
            })
            .catch(error => {
                console.error(`Error during ${actionType} for paper ${paperId}:`, error);
                alert(`An error occurred while ${actionType}ing paper ${paperId}: ${error.message}`);
            })
            .finally(() => {
                (classifyBtn || verifyBtn).disabled = false;
                if (actionType === 'classify') {
                    (classifyBtn || verifyBtn).innerHTML = 'Classify <strong>this paper</strong>';
                } else if (actionType === 'verify') {
                    (classifyBtn || verifyBtn).innerHTML = 'Verify <strong>this paper</strong>'; 
                }
            });
        }
    });


    // --- BibTeX Import Logic ---
    const importBibtexBtn = document.getElementById('import-bibtex-btn');
    const bibtexFileInput = document.getElementById('bibtex-file-input');
    // const batchStatusMessage = document.getElementById('batch-status-message'); // Reuse existing status element

    if (importBibtexBtn && bibtexFileInput) {
        // Clicking the button triggers the hidden file input
        importBibtexBtn.addEventListener('click', () => {
            bibtexFileInput.click();
        });

        // Handle file selection and upload
        bibtexFileInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) {
                if (!file.name.toLowerCase().endsWith('.bib')) {
                    alert('Please select a .bib file.');
                    bibtexFileInput.value = ''; // Clear the input
                    return;
                }

                if (!confirm(`Are you sure you want to import '${file.name}'?`)) {
                     bibtexFileInput.value = ''; // Clear the input
                     return;
                }

                const formData = new FormData();
                formData.append('file', file);

                // Disable button and show status
                importBibtexBtn.disabled = true;
                importBibtexBtn.textContent = 'Importing...';
                if (batchStatusMessage) {
                    batchStatusMessage.textContent = `Uploading and importing '${file.name}'...`;
                    batchStatusMessage.style.color = ''; // Reset color
                }

                fetch('/upload_bibtex', {
                    method: 'POST',
                    body: formData // Use FormData for file uploads
                    // Don't set Content-Type header, let browser set it with boundary
                })
                .then(response => {
                    if (!response.ok) {
                        return response.json().then(errData => {
                            throw new Error(errData.message || `HTTP error! status: ${response.status}`);
                        }).catch(() => {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        });
                    }
                    return response.json();
                })
                .then(data => {
                    if (data.status === 'success') {
                        console.log(data.message);
                        if (batchStatusMessage) {
                            batchStatusMessage.textContent = data.message;
                            batchStatusMessage.style.color = 'green'; // Success color
                        }
                        // Optional: Reload the page or fetch new data to show imported papers
                        // window.location.reload(); // Simple reload
                        // Or, fetch updated papers list (requires more JS logic)
                         setTimeout(() => { window.location.reload(); }, 1500); // Reload after delay
                    } else {
                        console.error("Import Error:", data.message);
                        if (batchStatusMessage) {
                            batchStatusMessage.textContent = `Import Error: ${data.message}`;
                            batchStatusMessage.style.color = 'red'; // Error color
                        }
                        alert(`Import failed: ${data.message}`);
                    }
                })
                .catch(error => {
                    console.error('Error uploading BibTeX file:', error);
                    if (batchStatusMessage) {
                        batchStatusMessage.textContent = `Upload Error: ${error.message}`;
                        batchStatusMessage.style.color = 'red'; // Error color
                    }
                    alert(`An error occurred during upload: ${error.message}`);
                })
                .finally(() => {
                    // Re-enable button and reset file input
                    importBibtexBtn.disabled = false;
                    importBibtexBtn.innerHTML = 'Import <strong>BibTeX</strong>'; // Restore original HTML
                    bibtexFileInput.value = ''; // Clear the input for next use
                    // Optionally clear status message after delay
                    // if (batchStatusMessage) {
                    //     setTimeout(() => {
                    //         if (batchStatusMessage.style.color === 'green' || batchStatusMessage.style.color === 'red') {
                    //              batchStatusMessage.textContent = '';
                    //              batchStatusMessage.style.color = '';
                    //         }
                    //     }, 5000);
                    // }
                });
            }
        });
    } else {
        console.warn("Import BibTeX button or file input not found.");
    }
    // --- End BibTeX Import Logic ---

    // --- Export HTML Button ---
    const exportHtmlBtn = document.getElementById('export-html-btn');
    if (exportHtmlBtn) {
        exportHtmlBtn.addEventListener('click', function() {
            console.log("Export HTML button clicked");
            // Gather current filter values from the UI elements
            const hideOfftopicCheckbox = document.getElementById('hide-offtopic-checkbox');
            const yearFromInput = document.getElementById('year-from');
            const yearToInput = document.getElementById('year-to');
            const minPageCountInput = document.getElementById('min-page-count');
            const searchInput = document.getElementById('search-input'); // Get search input

            let exportUrl = '/static_export?'; // Start building the URL

            // Add filters to the URL query parameters
            if (hideOfftopicCheckbox) {
                exportUrl += `hide_offtopic=${hideOfftopicCheckbox.checked ? '1' : '0'}&`;
            }
            if (yearFromInput && yearFromInput.value) {
                exportUrl += `year_from=${encodeURIComponent(yearFromInput.value)}&`;
            }
            if (yearToInput && yearToInput.value) {
                exportUrl += `year_to=${encodeURIComponent(yearToInput.value)}&`;
            }
            if (minPageCountInput && minPageCountInput.value) {
                exportUrl += `min_page_count=${encodeURIComponent(minPageCountInput.value)}&`;
            }
            if (searchInput && searchInput.value) { // Add search query
                exportUrl += `search_query=${encodeURIComponent(searchInput.value)}&`;
            }

            // Remove trailing '&' or '?' if present
            exportUrl = exportUrl.replace(/&$/, '');

            console.log("Export URL:", exportUrl);

            // --- Trigger the download asynchronously ---
            // Create a temporary invisible anchor element
            const link = document.createElement('a');
            link.href = exportUrl;
            link.style.display = 'none';
            // The filename will be suggested by the server's Content-Disposition header
            // link.download = 'PCBPapers_export.html'; // Optional: Suggest a default name if server doesn't set it
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            // Note: The browser's download manager should handle the file save dialog.
        });
    }

    document.getElementById('export-xlsx-btn').addEventListener('click', function() {
        // Reuse the logic from exportStaticBtn or create a specific one
        // This example reuses the core logic
        const currentUrlParams = new URLSearchParams(window.location.search);
        const exportUrlParams = new URLSearchParams();

        // Copy relevant filter parameters
        const relevantParams = ['hide_offtopic', 'year_from', 'year_to', 'min_page_count', 'search_query'];
        relevantParams.forEach(param => {
            const value = currentUrlParams.get(param);
            if (value !== null) {
                exportUrlParams.set(param, value);
            }
        });

        // Construct the URL for the Excel export endpoint
        const exportUrl = `/xlsx_export?${exportUrlParams.toString()}`;
        console.log("Exporting Excel with URL:", exportUrl);

        // Trigger the download
        window.location.href = exportUrl;
    });


});

// --- Extracted AJAX logic for reuse ---
function sendAjaxRequest(cell, dataToSend, currentText, row, paperId, field) {
    // Use the same endpoint as the form save
    const saveButton = row.querySelector('.save-btn'); // Find save button in details if needed for disabling
    const wasSaveButtonDisabled = saveButton ? saveButton.disabled : false;
    if (saveButton) saveButton.disabled = true; // Optional: disable main save while quick save happens

    fetch('/update_paper', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(dataToSend)
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(errData => {
                throw new Error(errData.message || `HTTP error! status: ${response.status}`);
            }).catch(() => {
                throw new Error(`HTTP error! status: ${response.status}`);
            });
        }
        return response.json();
    })
    .then(data => {
        if (data.status === 'success') {
            // 4. Update other relevant cells in the row based on the response
            const mainRow = document.querySelector(`tr[data-paper-id="${paperId}"]`);
            if (mainRow) {
                // Update audit fields (using formatted timestamp sent back)
                if (data.changed_formatted !== undefined) {
                    mainRow.querySelector('.changed-cell').textContent = data.changed_formatted;
                }
                if (data.changed_by !== undefined) {
                    mainRow.querySelector('.changed-by-cell').innerHTML = renderChangedBy(data.changed_by);
                }
                if (data.estimated_score !== undefined) {
                     const estimatedScoreCell = mainRow.cells[estScoreCellIndex]; 
                     if (estimatedScoreCell) {
                         estimatedScoreCell.textContent = data.estimated_score !== null && data.estimated_score !== undefined ? data.estimated_score : ''; // Example formatting
                     }
                }
            }
            updateCounts();
            console.log(`Quick save successful for ${paperId} field ${field}`);
        } else {
            console.error('Quick save error:', data.message);
            cell.textContent = currentText; // Revert text
        }
    })
    .catch((error) => {
        console.error('Quick save error:', error);
        cell.textContent = currentText; // Revert text
    })
    .finally(() => {
        if (saveButton) saveButton.disabled = wasSaveButtonDisabled;
    });
}

function saveChanges(paperId) {
    const form = document.getElementById(`form-${paperId}`);
    if (!form) {
        console.error(`Form not found for paper ID: ${paperId}`);
        return;
    }
    // --- Collect Main Fields ---
    const researchAreaInput = form.querySelector('input[name="research_area"]');
    const researchAreaValue = researchAreaInput ? researchAreaInput.value : '';
    const pageCountInput = form.querySelector('input[name="page_count"]');
    let pageCountValue = pageCountInput ? pageCountInput.value : '';
    // Convert empty string or invalid input to NULL for the database
    if (pageCountValue === '') {
        pageCountValue = null;
    } else {
        const parsedValue = parseInt(pageCountValue, 10);
        if (isNaN(parsedValue)) {
            pageCountValue = null; // Or handle error as needed
        } else {
            pageCountValue = parsedValue;
        }
    }

    // --- NEW: Collect Relevance Field ---
    const relevanceInput = form.querySelector('input[name="relevance"]');
    let relevanceValue = relevanceInput ? relevanceInput.value : '';
    // Convert empty string to NULL for the database consistency (optional but good practice)
    if (relevanceValue === '') {
        relevanceValue = null;
    } else {
        // If you want to ensure it's a number, uncomment the next lines:
        const parsedRelevance = parseFloat(relevanceValue); // or parseInt if it's an integer
        if (isNaN(parsedRelevance)) {
            relevanceValue = null; // Or handle error
        } else {
            relevanceValue = parsedRelevance;
        }
    }


    // --- Collect Additional Fields ---
    // Model Name -> technique_model
    const modelNameInput = form.querySelector('input[name="model_name"]');
    const modelNameValue = modelNameInput ? modelNameInput.value : '';
    // Other Defects -> features_other
    const otherDefectsInput = form.querySelector('input[name="features_other"]');
    const otherDefectsValue = otherDefectsInput ? otherDefectsInput.value : '';
    // User Comments -> user_trace (stored in main table column, not features/technique JSON)
    const userCommentsTextarea = form.querySelector('textarea[name="user_trace"]');
    const userCommentsValue = userCommentsTextarea ? userCommentsTextarea.value : '';

    // --- Prepare Data Payload ---
    const data = {
        id: paperId,
        research_area: researchAreaValue,
        page_count: pageCountValue,
        // --- NEW: Add Relevance Field to Payload ---
        relevance: relevanceValue,
        // --- Add Additional Fields to Payload ---
        // Prefix 'technique_' and 'features_' are handled by the backend
        technique_model: modelNameValue,
        features_other: otherDefectsValue,
        user_trace: userCommentsValue // This one is a direct column update
    };

    // --- UI Feedback and AJAX Call (Remains Largely the Same) ---
    const saveButton = form.querySelector('.save-btn');
    const originalText = saveButton ? saveButton.textContent : 'Save Changes';
    if (saveButton) {
        saveButton.textContent = 'Saving...';
        saveButton.disabled = true;
    }
    fetch('/update_paper', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data) // <-- Send the updated data object
    })
    .then(response => {
        if (!response.ok) {
             return response.json().then(errData => {
                 throw new Error(errData.message || `HTTP error! status: ${response.status}`);
             }).catch(() => {
                 throw new Error(`HTTP error! status: ${response.status}`);
             });
        }
        return response.json();
    })
    .then(data => {
        if (data.status === 'success') {
            const row = document.querySelector(`tr[data-paper-id="${paperId}"]`);
            if (row) {
                // Update displayed audit fields if returned
                if (data.changed_formatted !== undefined) {
                    row.querySelector('.changed-cell').textContent = data.changed_formatted;
                }
                if (data.changed_by !== undefined) {
                    row.querySelector('.changed-by-cell').innerHTML = renderChangedBy(data.changed_by);
                }
                // Update displayed page count if returned
                const pageCountCell = row.cells[pageCountCellIndex];
                if (pageCountCell) {
                     pageCountCell.textContent = data.page_count !== null && data.page_count !== undefined ? data.page_count : '';
                }
                // --- NEW: Update displayed relevance if returned ---
                // Find the relevance cell in the main row (adjust selector if needed)
                const relevanceCell = row.querySelector('td:nth-child(7)'); // Or better, add a class like .relevance-cell to the <td> and use '.relevance-cell'
                if (relevanceCell) {
                     relevanceCell.textContent = data.relevance !== null && data.relevance !== undefined ? data.relevance : '';
                }
                // Note: The UI fields (model_name, features_other, user_trace) are NOT updated here
                // from the server response because update_paper_custom_fields doesn't return them.
                // They retain the user-entered value after saving.
            }
            // Collapse details row after successful save
            const toggleBtn = row ? row.querySelector('.toggle-btn') : null;
            if (toggleBtn && row && row.nextElementSibling && row.nextElementSibling.classList.contains('expanded')) {
                 toggleDetails(toggleBtn);
            }
            if (saveButton) {
                saveButton.textContent = 'Saved!';
                setTimeout(() => {
                    if (saveButton) {
                        saveButton.textContent = originalText;
                        saveButton.disabled = false;
                    }
                }, 1500);
            }
            updateCounts();
        } else {
            console.error('Save error:', data.message);
            if (saveButton) {
                saveButton.textContent = originalText;
                saveButton.disabled = false;
            }
        }
    })
    .catch((error) => {
        console.error('Error:', error);
        if (saveButton) {
            saveButton.textContent = originalText;
            saveButton.disabled = false;
        }
    });
}
```

```javascript
# static\filtering.js
// static/filtering.js
const searchInput = document.getElementById('search-input');
const hideOfftopicCheckbox = document.getElementById('hide-offtopic-checkbox');
const hideXrayCheckbox = document.getElementById('hide-xray-checkbox');
const hideApprovedCheckbox = document.getElementById('hide-approved-checkbox');
const onlySurveyCheckbox = document.getElementById('only-survey-checkbox');

const showPCBcheckbox = document.getElementById('show-pcb-checkbox');
const showSolderCheckbox = document.getElementById('show-solder-checkbox');
const showPCBAcheckbox = document.getElementById('show-pcba-checkbox');

const minPageCountInput = document.getElementById('min-page-count');
const yearFromInput = document.getElementById('year-from');
const yearToInput = document.getElementById('year-to');
const visiblePapersCountCell = document.getElementById('visible-papers-count');
const loadedPapersCountCell = document.getElementById('loaded-papers-count');
const applyButton = document.getElementById('apply-serverside-filters');
// const totalPapersCountCell = document.getElementById('total-papers-count');

const headers = document.querySelectorAll('th[data-sort]');
let currentClientSort = { column: null, direction: 'ASC' };

let filterTimeoutId = null;
const FILTER_DEBOUNCE_DELAY = 200;

// Pre-calculate symbol weights OUTSIDE the sort loop for efficiency
const SYMBOL_SORT_WEIGHTS = {
    '✔️': 2, // Yes
    '❌': 1, // No
    '❔': 0  // Unknown
};

function updateCounts() {   //used by stats, comms and filtering
    const counts = {};
    const yearlySurveyImpl = {}; // { year: { surveys: count, impl: count } }
    const yearlyTechniques = {}; // { year: { technique_field: count, ... } }
    const yearlyFeatures =   {}; // { year: { feature_field: count, ... } }
    const yearlyPubTypes = {}; // { year: { pubtype1: count, pubtype2: count, ... } }

    COUNT_FIELDS.forEach(field => counts[field] = 0);

    // Select only VISIBLE main rows for counting '✔️' and calculating visible count
    const visibleRows = document.querySelectorAll('#papersTable tbody tr[data-paper-id]:not(.filter-hidden)');
    const visiblePaperCount = visibleRows.length;

    //count on each update since server-side async can change this:
    const allRows = document.querySelectorAll('#papersTable tbody tr[data-paper-id]');
    const loadedPaperCount = allRows.length;

    // Count symbols in visible rows and collect yearly data
    visibleRows.forEach(row => {
        COUNT_FIELDS.forEach(field => {
            const cell = row.querySelector(`[data-field="${field}"]`);
            const cellText = cell.textContent.trim();
            if (field === 'changed_by' || field === 'verified_by') {
                if (cellText === '👤') {
                    counts[field]++;
                }
            } else {
                if (cellText === '✔️') {
                    counts[field]++;
                }
            }
        });

        const yearCell = row.cells[yearCellIndex]; // Assuming Year is the 3rd column (index 2)
        const yearText = yearCell ? yearCell.textContent.trim() : '';
        const year = yearText ? parseInt(yearText, 10) : null;

        if (year && !isNaN(year)) {
            // Initialize yearly data objects for the year if they don't exist
            if (!yearlySurveyImpl[year]) {
                yearlySurveyImpl[year] = { surveys: 0, impl: 0 };
            }
            if (!yearlyTechniques[year]) {
                yearlyTechniques[year] = {};
                TECHNIQUE_FIELDS_FOR_YEARLY.forEach(f => yearlyTechniques[year][f] = 0);
            }
            if (!yearlyFeatures[year]) {
                yearlyFeatures[year] = {};
                FEATURE_FIELDS_FOR_YEARLY.forEach(f => yearlyFeatures[year][f] = 0);
            }


            // --- NEW: Update Publication Type counts ---
            const typeCell = row.cells[typeCellIndex]; // Assuming Type is the 1st column (index 0)
            const pubTypeText = typeCell ? typeCell.getAttribute('title') || typeCell.textContent.trim() : ''; // Use title for full type if available
            if (pubTypeText) {
                if (!yearlyPubTypes[year]) {
                    yearlyPubTypes[year] = {}; // Initialize object for this year's types
                }
                // Increment count for this type in this year
                yearlyPubTypes[year][pubTypeText] = (yearlyPubTypes[year][pubTypeText] || 0) + 1;
            }

            // Update Survey/Impl counts
            const isSurveyCell = row.querySelector('.editable-status[data-field="is_survey"]');
            const isSurvey = isSurveyCell && isSurveyCell.textContent.trim() === '✔️';
            if (isSurvey) {
                yearlySurveyImpl[year].surveys++;
            } else {
                yearlySurveyImpl[year].impl++;
            }

            // Update Technique counts
            TECHNIQUE_FIELDS_FOR_YEARLY.forEach(field => {
                const techCell = row.querySelector(`.editable-status[data-field="${field}"]`);
                if (techCell && techCell.textContent.trim() === '✔️') {
                    yearlyTechniques[year][field]++;
                }
            });

            // Update Feature counts
            FEATURE_FIELDS_FOR_YEARLY.forEach(field => {
                // const featCell = row.querySelector(`.editable-status[data-field="${field}"]`); //breaks "other" counts in chart, as it's a calculated, non-editable cell!
                const featCell = row.querySelector(`[data-field="${field}"]`);
                if (featCell && featCell.textContent.trim() === '✔️') {
                    yearlyFeatures[year][field]++;
                }
            });
        }
    });
    // Make counts available outside this function
    latestCounts = counts; 
    latestYearlyData = {
        surveyImpl: yearlySurveyImpl,
        techniques: yearlyTechniques,
        features: yearlyFeatures,
        pubTypes: yearlyPubTypes // <-- Add this line
    };

    loadedPapersCountCell.textContent = loadedPaperCount;
    visiblePapersCountCell.textContent = visiblePaperCount;
    COUNT_FIELDS.forEach(field => {
        const countCell = document.getElementById(`count-${field}`);
        if (countCell) {
            countCell.textContent = counts[field];
        }
    });
}

function toggleDetails(element) {
    const row = element.closest('tr');
    const detailRow = row.nextElementSibling;
    const isExpanded = detailRow && detailRow.classList.contains('expanded');
    const paperId = row.getAttribute('data-paper-id');

    if (isExpanded) {
        detailRow.classList.remove('expanded');
        element.innerHTML = '<span>Show</span>';
    } else {
        detailRow.classList.add('expanded');
        element.innerHTML = '<span>Hide</span>';
        const contentPlaceholder = detailRow.querySelector('.detail-content-placeholder');
        fetch(`/get_detail_row?paper_id=${encodeURIComponent(paperId)}`)
            .then(response => {
                return response.json();
            })
            .then(data => {
                if (data.status === 'success' && data.html) {
                    contentPlaceholder.innerHTML = data.html;
                } else {  // Handle error from server
                    console.error(`Error loading detail row for paper ${paperId}:`, data.message);
                    if (contentPlaceholder) {
                        contentPlaceholder.innerHTML = `<p>Error loading details: ${data.message || 'Unknown error'}</p>`;
                    }
                }
            })
            .catch(error => {  // Handle network or other errors
                console.error(`Error fetching detail row for paper ${paperId}:`, error);
                if (contentPlaceholder) {
                    contentPlaceholder.innerHTML = `<p>Error loading details: ${error.message}</p>`;
                }
            });
    }
}
/**
 * Applies alternating row shading to visible main rows.
 * Ensures detail rows follow their main row's shading.
 * Each "paper group" (main row + detail row) gets a single alternating color.
 */
function applyAlternatingShading() {
    // Select only visible main rows
    const visibleMainRows = document.querySelectorAll('#papersTable tbody tr[data-paper-id]:not(.filter-hidden)');

    // Iterate through the visible main rows. The index 'index' now represents the paper group index.
    visibleMainRows.forEach((mainRow, groupIndex) => {
        // Determine the shade class based on the paper group index (groupIndex)
        // This ensures each paper group (main + detail) gets one color, alternating per group.
        const shadeClass = (groupIndex % 2 === 0) ? 'alt-shade-1' : 'alt-shade-2';

        // Remove any existing alternating shade classes from the main row
        mainRow.classList.remove('alt-shade-1', 'alt-shade-2');
        mainRow.classList.add(shadeClass);

        // --- Handle Detail Row Shading ---
        mainRow.nextElementSibling.classList.remove('alt-shade-1', 'alt-shade-2');
        mainRow.nextElementSibling.classList.add(shadeClass);
        // Note: Ensure CSS .detail-row has background-color: inherit; or no background-color set
        // so it uses the one from the .alt-shade-* class.
    });
}

function applyJournalShading(rows) {
    const journalCounts = new Map();

    rows.forEach(row => {        // Only count visible rows (not hidden by filters)
        if (!row.classList.contains('filter-hidden')) {
            const journalCell = row.cells[journalCellIndex]; //see comms.js
            const journalName = journalCell.textContent.trim();
            journalCounts.set(journalName, (journalCounts.get(journalName) || 0) + 1);
        }
    });
    // Determine the maximum count for scaling
    let maxCount = 0;
    for (const count of journalCounts.values()) {
        if (count > maxCount) maxCount = count;
    }

    // Define base shade color (light blue/greenish tint)
    // You can adjust the HSL values for different base colors or intensity
    const baseHue = 210; // Blueish
    const baseSaturation = 66;
    const minLightness = 96; // Lightest shade (almost white)
    const maxLightness = 84; // Darkest shade when maxCount is high

    rows.forEach(row => {
        const journalCell = row.cells[journalCellIndex];
        journalCell.style.backgroundColor = '';

        // Only apply shading if the row is visible and has a journal name
        if (!row.classList.contains('filter-hidden')) {
            const journalName = journalCell.textContent.trim();
            if (journalName) {  //avoids shading blank journals
                const count = journalCounts.get(journalName) || 0;
                if (count >= 2) { 
                    // Scale lightness between maxLightness and minLightness
                    let lightness;
                    if (maxCount <= 1) {
                        lightness = minLightness; // Avoid division by zero or negative
                    } else {
                        lightness = maxLightness + (minLightness - maxLightness) * (1 - (count - 1) / (maxCount - 1));
                        lightness = Math.max(maxLightness, Math.min(minLightness, lightness));         // Ensure lightness stays within bounds
                    }
                    journalCell.style.backgroundColor = `hsl(${baseHue}, ${baseSaturation}%, ${lightness}%)`;
                }
            }
        }
    });
}


function applyServerSideFilters() {
    document.documentElement.classList.add('busyCursor');
    const urlParams = new URLSearchParams(window.location.search);

    const isOfftopicChecked = hideOfftopicCheckbox.checked;
    urlParams.set('hide_offtopic', isOfftopicChecked ? '1' : '0');

    const yearFromValue = document.getElementById('year-from').value.trim();
    if (yearFromValue !== '' && !isNaN(parseInt(yearFromValue))) {
        urlParams.set('year_from', yearFromValue);
    } else {
        urlParams.delete('year_from');
    }
    const yearToValue = document.getElementById('year-to').value.trim();
    if (yearToValue !== '' && !isNaN(parseInt(yearToValue))) {
        urlParams.set('year_to', yearToValue);
    } else {
        urlParams.delete('year_to');
    }

    const minPageCountValue = document.getElementById('min-page-count').value.trim();
    if (minPageCountValue !== '' && !isNaN(parseInt(minPageCountValue))) {
        urlParams.set('min_page_count', minPageCountValue);
    } else {
        urlParams.delete('min_page_count');
    }

    const searchValue = document.getElementById('search-input').value.trim();
    if (searchValue !== '') {
        urlParams.set('search_query', searchValue);
    } else {
        urlParams.delete('search_query');
    }
    // Construct the URL for the /load_table endpoint with current parameters
    const loadTableUrl = `/load_table?${urlParams.toString()}`;
    fetch(loadTableUrl)
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.text();
        })
        .then(html => {
            const tbody = document.querySelector('#papersTable tbody');
            if (tbody) {
                tbody.innerHTML = html;
                const newUrl = `${window.location.pathname}?${urlParams.toString()}`;
                window.history.replaceState({ path: newUrl }, '', newUrl);
                applyLocalFilters(); //update local filters and let it remove busy state
            }
        })
        .catch(error => {
            console.error('Error fetching updated table:', error);
            document.documentElement.classList.remove('busyCursor');
        });
}

function applyLocalFilters() {
    clearTimeout(filterTimeoutId);
    document.documentElement.classList.add('busyCursor');    // Set the cursor immediately on user interaction
    filterTimeoutId = setTimeout(() => {// Debounce the actual filtering
        const tbody = document.querySelector('#papersTable tbody');
        if (!tbody) return;
        const hideXrayChecked = hideXrayCheckbox.checked;
        const onlySurveyChecked = onlySurveyCheckbox.checked;
        const hideApprovedChecked = hideApprovedCheckbox.checked;

        // --- NEW: Get the state of PCB/Solder/PCBA checkboxes ---
        const showPCBChecked = showPCBcheckbox.checked;
        const showSolderChecked = showSolderCheckbox.checked;
        const showPCBAChecked = showPCBAcheckbox.checked;

        const rows = tbody.querySelectorAll('tr[data-paper-id]');
        rows.forEach(row => {
            let showRow = true;
            let detailRow = row.nextElementSibling; // Get the associated detail row

            // Existing filters (X-Ray, Survey, Approved)
            if (showRow && hideXrayChecked) {
                const xrayCell = row.querySelector('.editable-status[data-field="is_x_ray"]');
                if (xrayCell && xrayCell.textContent.trim() === '✔️') {
                    showRow = false;
                }
            }
            if (showRow && onlySurveyChecked) {
                const surveyCell = row.querySelector('.editable-status[data-field="is_survey"]');
                if (surveyCell && surveyCell.textContent.trim() === '❌') {
                    showRow = false;
                }
            }
            if (showRow && hideApprovedChecked) {
                const verifiedCell = row.querySelector('.editable-status[data-field="verified"]');
                if (verifiedCell && verifiedCell.textContent.trim() === '✔️') {
                    showRow = false;
                }
            }

            // --- Apply NEW PCB/Solder/PCBA Group Filters (Inclusion via OR Logic) ---
            // Only apply this filter if at least one group is enabled (checked)
            if (showRow && (showPCBChecked || showSolderChecked || showPCBAChecked)) {
                let hasPCBFeature = false;
                let hasSolderFeature = false;
                let hasPCBAFeature = false;

                // Helper function to check if a paper has ANY '✔️' in a given list of feature fields
                const hasAnyFeature = (featureFields) => {
                    return featureFields.some(fieldName => {
                        const cell = row.querySelector(`[data-field="${fieldName}"]`);
                        return cell && cell.textContent.trim() === '✔️';
                    });
                };

                // Define feature fields for each group
                const pcbFeatures = ['features_tracks', 'features_holes'];
                const solderFeatures = [
                    'features_solder_insufficient',
                    'features_solder_excess',
                    'features_solder_void',
                    'features_solder_crack'
                ];
                const pcbaFeatures = [
                    'features_orientation',
                    'features_missing_component',
                    'features_wrong_component',
                    'features_cosmetic',
                    'features_other_state'
                ];

                // Check which groups the paper belongs to (has at least one ✔️)
                if (showPCBChecked) {
                    hasPCBFeature = hasAnyFeature(pcbFeatures);
                }
                if (showSolderChecked) {
                    hasSolderFeature = hasAnyFeature(solderFeatures);
                }
                if (showPCBAChecked) {
                    hasPCBAFeature = hasAnyFeature(pcbaFeatures);
                }

                // The core OR logic:
                // Hide the row ONLY if it does NOT belong to ANY of the enabled groups.
                // In other words, show the row if it belongs to at least one enabled group.
                if (!(hasPCBFeature || hasSolderFeature || hasPCBAFeature)) {
                    showRow = false;
                }
            }
            // Apply the visibility state
            row.classList.toggle('filter-hidden', !showRow);
            if (detailRow) { // Ensure detailRow exists before toggling
                detailRow.classList.toggle('filter-hidden', !showRow);
            }
        });

        applyAlternatingShading();
        applyJournalShading(document.querySelectorAll('#papersTable tbody tr[data-paper-id]:not(.filter-hidden)'));
        updateCounts();
        applyButton.style.opacity = '0';
        applyButton.style.pointerEvents = 'none';
        setTimeout(() => {
            document.documentElement.classList.remove('busyCursor');
        }, 150); // doesn't really work since the contents are completely replaced eliminating the animation. Not worth fixing.
    }, FILTER_DEBOUNCE_DELAY);
}

function sortTable(){
    document.documentElement.classList.add('busyCursor');

    setTimeout(() => {
        const sortBy = this.getAttribute('data-sort');
        if (!sortBy) return;

        let newDirection = 'DESC';
        if (currentClientSort.column === sortBy) {
            newDirection = currentClientSort.direction === 'DESC' ? 'ASC' : 'DESC';
        }
        const tbody = document.querySelector('#papersTable tbody');

        // --- PRE-PROCESS: Extract Sort Values and Row References ---
        const visibleMainRows = tbody.querySelectorAll('tr[data-paper-id]:not(.filter-hidden)');
        const headerIndex = Array.prototype.indexOf.call(this.parentNode.children, this);
        const sortData = [];
        let mainRow, paperId, cellValue, detailRow, cell;

        for (let i = 0; i < visibleMainRows.length; i++) {
            mainRow = visibleMainRows[i];
            paperId = mainRow.getAttribute('data-paper-id');

            // --- Extract cell value based on column type ---
            if (['title', 'year', 'journal', /*'authors',*/ 'page_count', 'estimated_score', 'relevance'].includes(sortBy)) {
                cell = mainRow.cells[headerIndex];
                cellValue = cell ? cell.textContent.trim() : '';
                if (sortBy === 'year' || sortBy === 'estimated_score' || sortBy === 'page_count' || sortBy === 'relevance') {
                    cellValue = parseFloat(cellValue) || 0;
                }
            } else if (['type', 'changed', 'changed_by', 'verified', 'verified_by', 'research_area', 'user_comment_state', 'features_other_state'].includes(sortBy)) {
                cell = mainRow.cells[headerIndex];
                cellValue = cell ? cell.textContent.trim() : '';
            } else { // Status/Feature/Technique columns
                cell = mainRow.querySelector(`.editable-status[data-field="${sortBy}"]`);
                // Use SYMBOL_SORT_WEIGHTS for sorting, defaulting to 0 if symbol not found
                cellValue = SYMBOL_SORT_WEIGHTS[cell?.textContent.trim()] ?? 0;
            }

            detailRow = mainRow.nextElementSibling; // Get the associated detail row
            sortData.push({ value: cellValue, mainRow, detailRow, paperId });
        }

        sortData.sort((a, b) => {
            let comparison = 0;
            if (a.value > b.value) comparison = 1;
            else if (a.value < b.value) comparison = -1;
            else {  // Secondary sort by paperId to ensure stable sort
                if (a.paperId > b.paperId) comparison = 1;
                else if (a.paperId < b.paperId) comparison = -1;
            }
            return newDirection === 'DESC' ? -comparison : comparison;
        });

        // --- BATCH UPDATE the DOM ---
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < sortData.length; i++) {
            fragment.appendChild(sortData[i].mainRow);
            fragment.appendChild(sortData[i].detailRow);
        }
        tbody.appendChild(fragment); // Single DOM append operation

        // --- Schedule UI Updates after DOM change ---
        // Use requestAnimationFrame to align with browser repaint
        requestAnimationFrame(() => {
            applyAlternatingShading();
            const currentVisibleRowsForJournal = document.querySelectorAll('#papersTable tbody tr[data-paper-id]:not(.filter-hidden)');
            applyJournalShading(currentVisibleRowsForJournal);
            updateCounts();
        });
        currentClientSort = { column: sortBy, direction: newDirection };
        document.querySelectorAll('th .sort-indicator').forEach(ind => ind.textContent = '');
        const indicator = this.querySelector('.sort-indicator');
        if (indicator) {
            indicator.textContent = newDirection === 'ASC' ? '▲' : '▼';
        }
        // 3. Schedule removal of the busy cursor class AFTER a guaranteed delay
        // This ensures the CSS transition has time to play.
        // The delay (150ms) should be >= CSS transition duration (0.3s) + delay (0.1s) if you want full transition,
        // but even a shorter delay (longer than CSS delay) often works to trigger it.
        setTimeout(() => {
            document.documentElement.classList.remove('busyCursor');
        }, 150); // Delay slightly longer than CSS transition delay
    }, 20); // Initial defer for adding busy cursor (can keep this small or match rAF timing ~16ms)
}

function showApplyButton(){  applyButton.style.opacity = '1'; applyButton.style.pointerEvents = 'visible'; }

document.addEventListener('DOMContentLoaded', function () {
    hideOfftopicCheckbox.addEventListener('change', applyServerSideFilters);
    hideXrayCheckbox.addEventListener('change', applyLocalFilters);
    hideApprovedCheckbox.addEventListener('change', applyLocalFilters);
    onlySurveyCheckbox.addEventListener('change', applyLocalFilters);
    showPCBcheckbox.addEventListener('change', applyLocalFilters);
    showSolderCheckbox.addEventListener('change', applyLocalFilters);
    showPCBAcheckbox.addEventListener('change', applyLocalFilters);

    yearFromInput.addEventListener('change', showApplyButton);
    yearToInput.addEventListener('change', showApplyButton);
    minPageCountInput.addEventListener('change', showApplyButton);

    applyButton.addEventListener('click', applyServerSideFilters);

    document.getElementById('search-input').addEventListener('input', function () {
        clearTimeout(filterTimeoutId);
        filterTimeoutId = setTimeout(() => {
            applyServerSideFilters();
        }, 300);  //additional debounce for typing
    });
    
    headers.forEach(header => { header.addEventListener('click', sortTable);   });
    applyLocalFilters(); //apply initial filtering    


    // 2. After initial filters are applied (which includes the initial sortTable call
    //    if triggered by applyLocalFilters, but we'll override it),
    //    find the 'user_comment_state' header and trigger the sort.
    //    Use setTimeout with 0 delay to ensure it runs after the current
    //    execution stack (including the applyLocalFilters timeout) is clear.
    setTimeout(() => {
        const commentedHeader = document.querySelector('th[data-sort="user_comment_state"]');
        if (commentedHeader) {
            // Set the initial sort state so the UI indicator is correct
            currentClientSort = { column: "user_comment_state", direction: 'DESC' }; // Or 'ASC' if preferred

            // Call sortTable with the correct 'this' context (the header element)
            // We need to bind 'this' or call it directly on the element
            sortTable.call(commentedHeader);

            // Update the sort indicator visually
            // Clear previous indicators
            document.querySelectorAll('th .sort-indicator').forEach(ind => ind.textContent = '');
            // Set the indicator on the target header
            const indicator = commentedHeader.querySelector('.sort-indicator');
            if (indicator) {
                 // Use '▼' for DESC, '▲' for ASC based on your sortTable logic
                indicator.textContent = currentClientSort.direction === 'ASC' ? '▲' : '▼';
            }
        }
    }, 0); // Ensures it runs after applyLocalFilters' timeout finishes
});
```

```css
# static\fonts.css
/* inter-tight-300 - latin_latin-ext */
@font-face {
    font-display: swap; /* Check https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-display for other options. */
    font-family: 'Inter Tight';
    font-style: normal;
    font-weight: 300;
    src: url('./fonts/inter-tight-v7-latin_latin-ext-300.woff2') format('woff2'), /* Chrome 36+, Opera 23+, Firefox 39+, Safari 12+, iOS 10+ */
            url('./fonts/inter-tight-v7-latin_latin-ext-300.ttf') format('truetype'); /* Chrome 4+, Firefox 3.5+, IE 9+, Safari 3.1+, iOS 4.2+, Android Browser 2.2+ */
}

/* inter-tight-regular - latin_latin-ext */
@font-face {
    font-display: swap; /* Check https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-display for other options. */
    font-family: 'Inter Tight';
    font-style: normal;
    font-weight: 400;
    src: url('./fonts/inter-tight-v7-latin_latin-ext-regular.woff2') format('woff2'), /* Chrome 36+, Opera 23+, Firefox 39+, Safari 12+, iOS 10+ */
         url('./fonts/inter-tight-v7-latin_latin-ext-regular.ttf') format('truetype'); /* Chrome 4+, Firefox 3.5+, IE 9+, Safari 3.1+, iOS 4.2+, Android Browser 2.2+ */
}
    
/* inter-tight-600 - latin_latin-ext */
@font-face {
    font-display: swap; /* Check https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-display for other options. */
    font-family: 'Inter Tight';
    font-style: normal;
    font-weight: 600;
    src: url('./fonts/inter-tight-v7-latin_latin-ext-600.woff2') format('woff2'), /* Chrome 36+, Opera 23+, Firefox 39+, Safari 12+, iOS 10+ */
            url('./fonts/inter-tight-v7-latin_latin-ext-600.ttf') format('truetype'); /* Chrome 4+, Firefox 3.5+, IE 9+, Safari 3.1+, iOS 4.2+, Android Browser 2.2+ */
}

/* noto-color-emoji-regular */
@font-face {
    font-display: swap; /* or 'optional' or 'swap' depending on your preference */
    font-family: 'Noto Color Emoji'; /* Use the standard name for the font */
    font-style: normal;
    font-weight: 400;
    src: url('./fonts/NotoColorEmoji-Regular.ttf') format('truetype'); /* Path to your local TTF file */
}

/* SegoeUIEmojiWin11 */
@font-face {
    font-display: swap; /* or 'optional' or 'swap' depending on your preference */
    font-family: 'Segoe UI Emoji Windows 11'; /* Use the standard name for the font */
    font-style: normal;
    font-weight: 400;
    src: url('./fonts/SegoeUIEmojiWin11.ttf') format('truetype'); /* Path to your local TTF file */
}
```

```javascript
# static\ghpages.js
// static/ghpages.js
const searchInput = document.getElementById('search-input');
const hideOfftopicCheckbox = document.getElementById('hide-offtopic-checkbox');
const hideXrayCheckbox = document.getElementById('hide-xray-checkbox');
const hideApprovedCheckbox = document.getElementById('hide-approved-checkbox');
const onlySurveyCheckbox = document.getElementById('only-survey-checkbox');

const showPCBcheckbox = document.getElementById('show-pcb-checkbox');
const showSolderCheckbox = document.getElementById('show-solder-checkbox');
const showPCBAcheckbox = document.getElementById('show-pcba-checkbox');

const minPageCountInput = document.getElementById('min-page-count');
const yearFromInput = document.getElementById('year-from');
const yearToInput = document.getElementById('year-to');

const allRows = document.querySelectorAll('#papersTable tbody tr[data-paper-id]');
const totalPaperCount = allRows.length;

let filterTimeoutId = null;
const FILTER_DEBOUNCE_DELAY = 200;
const headers = document.querySelectorAll('th[data-sort]');
let currentClientSort = { column: null, direction: 'ASC' };

//Hardocoded cells - to update in this script:
const typeCellIndex = 0;
const yearCellIndex = 2;
const journalCellIndex = 3;
const pageCountCellIndex = 4;
const estScoreCellIndex = 34;

const SYMBOL_SORT_WEIGHTS = {
    '✔️': 2,
    '❌': 1,
    '❔': 0
};

function scheduleFilterUpdate() {
    clearTimeout(filterTimeoutId);
    document.documentElement.classList.add('busyCursor');
    filterTimeoutId = setTimeout(() => {
        setTimeout(() => {
            const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
            const tbody = document.querySelector('#papersTable tbody');
            if (!tbody) return;

            // --- Get filter values ---
            const hideOfftopicChecked = hideOfftopicCheckbox.checked;
            const hideXrayChecked = hideXrayCheckbox.checked;
            const onlySurveyChecked = onlySurveyCheckbox.checked;
            const hideApprovedChecked = hideApprovedCheckbox.checked;
            const minPageCountValue = minPageCountInput ? parseInt(minPageCountInput.value, 10) || 0 : 0;
            // Get year range values
            const yearFromValue = yearFromInput ? parseInt(yearFromInput.value, 10) || 0 : 0;
            const yearToValue = yearToInput ? parseInt(yearToInput.value, 10) || Infinity : Infinity;
            // --- NEW: Get the state of PCB/Solder/PCBA checkboxes ---
            const showPCBChecked = showPCBcheckbox.checked;
            const showSolderChecked = showSolderCheckbox.checked;
            const showPCBAChecked = showPCBAcheckbox.checked;

            const rows = tbody.querySelectorAll('tr[data-paper-id]');
            rows.forEach(row => {
                let showRow = true;
                const paperId = row.getAttribute('data-paper-id');
                let detailRow = null;
                if (paperId) {
                    let nextSibling = row.nextElementSibling;
                    while (nextSibling && !nextSibling.classList.contains('detail-row')) {
                        if (nextSibling.hasAttribute('data-paper-id')) break;
                        nextSibling = nextSibling.nextElementSibling;
                    }
                    if (nextSibling && nextSibling.classList.contains('detail-row')) {
                        detailRow = nextSibling;
                    }
                }

                if (showRow && hideOfftopicChecked) {
                    const offtopicCell = row.querySelector('.editable-status[data-field="is_offtopic"]');
                    if (offtopicCell && offtopicCell.textContent.trim() === '✔️') {
                        showRow = false;
                    }
                }
                if (showRow && hideXrayChecked) {
                    const offtopicCell = row.querySelector('.editable-status[data-field="is_x_ray"]');
                    if (offtopicCell && offtopicCell.textContent.trim() === '✔️') {
                        showRow = false;
                    }
                }
                if (showRow && hideApprovedChecked) {
                    const offtopicCell = row.querySelector('.editable-status[data-field="verified"]');
                    if (offtopicCell && offtopicCell.textContent.trim() === '✔️') {
                        showRow = false;
                    }
                }
                if (showRow && onlySurveyChecked) {
                    const offtopicCell = row.querySelector('.editable-status[data-field="is_survey"]');
                    if (offtopicCell && offtopicCell.textContent.trim() === '❌') {
                        showRow = false;
                    }
                }

                // 2. Minimum Page Count
                // Only hide if page count is a known number and it's less than the minimum
                if (showRow && minPageCountValue > 0) { // Only check if min value is set
                    const pageCountCell = row.cells[4]; // Index 4 for 'Pages' column
                    if (pageCountCell) {
                        const pageCountText = pageCountCell.textContent.trim();
                        // Only filter if there's actual text to parse
                        if (pageCountText !== '') {
                            const pageCount = parseInt(pageCountText, 10);
                            // If parsing was successful and the number is less than the minimum, hide
                            if (!isNaN(pageCount) && pageCount < minPageCountValue) {
                                showRow = false;
                            }
                        }
                        // If pageCountText is '', pageCount is NaN, or pageCount >= min, row stays visible
                    }
                }

                // 3. Year Range
                if (showRow) {
                    const yearCell = row.cells[2]; // Index 2 for 'Year' column
                    if (yearCell) {
                        const yearText = yearCell.textContent.trim();
                        const year = yearText ? parseInt(yearText, 10) : NaN;
                        // If year is not a number or outside the range, hide the row
                        // Ensure year is valid before comparison
                        if (isNaN(year) || year < yearFromValue || year > yearToValue) {
                            showRow = false;
                        }
                    }
                }

                // 4. Search Term
                if (showRow && searchTerm) {
                    let rowText = (row.textContent || '').toLowerCase();
                    let detailText = '';
                    if (detailRow) {
                        const detailClone = detailRow.cloneNode(true);
                        // Exclude traces from search if desired (as in original)
                        detailClone.querySelector('.detail-evaluator-trace .trace-content')?.remove();
                        detailClone.querySelector('.detail-verifier-trace .trace-content')?.remove();
                        detailText = (detailClone.textContent || '').toLowerCase();
                    }
                    if (!rowText.includes(searchTerm) && !detailText.includes(searchTerm)) {
                        showRow = false;
                    }
                }

                // --- Apply NEW PCB/Solder/PCBA Group Filters (Inclusion via OR Logic) ---
                // Only apply this filter if at least one group is enabled (checked)
                if (showRow && (showPCBChecked || showSolderChecked || showPCBAChecked)) {
                    let hasPCBFeature = false;
                    let hasSolderFeature = false;
                    let hasPCBAFeature = false;

                    // Helper function to check if a paper has ANY '✔️' in a given list of feature fields
                    const hasAnyFeature = (featureFields) => {
                        return featureFields.some(fieldName => {
                            const cell = row.querySelector(`[data-field="${fieldName}"]`);
                            return cell && cell.textContent.trim() === '✔️';
                        });
                    };

                    // Define feature fields for each group
                    const pcbFeatures = ['features_tracks', 'features_holes'];
                    const solderFeatures = [
                        'features_solder_insufficient',
                        'features_solder_excess',
                        'features_solder_void',
                        'features_solder_crack'
                    ];
                    const pcbaFeatures = [
                        'features_orientation',
                        'features_missing_component',
                        'features_wrong_component',
                        'features_cosmetic',
                        'features_other_state'
                    ];

                    // Check which groups the paper belongs to (has at least one ✔️)
                    if (showPCBChecked) {
                        hasPCBFeature = hasAnyFeature(pcbFeatures);
                    }
                    if (showSolderChecked) {
                        hasSolderFeature = hasAnyFeature(solderFeatures);
                    }
                    if (showPCBAChecked) {
                        hasPCBAFeature = hasAnyFeature(pcbaFeatures);
                    }

                    // The core OR logic:
                    // Hide the row ONLY if it does NOT belong to ANY of the enabled groups.
                    // In other words, show the row if it belongs to at least one enabled group.
                    if (!(hasPCBFeature || hasSolderFeature || hasPCBAFeature)) {
                        showRow = false;
                    }
                }


                // Apply the visibility state
                row.classList.toggle('filter-hidden', !showRow);
                if (detailRow) { // Ensure detailRow exists before toggling
                    detailRow.classList.toggle('filter-hidden', !showRow);
                }
            });
            updateCounts();
            applyAlternatingShading();
            document.documentElement.classList.remove('busyCursor');
        }, 0);
    }, FILTER_DEBOUNCE_DELAY);
}

function toggleDetails(element) {
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

// --- Modified updateCounts Function ---
let latestCounts = {}; // This will store the counts calculated by updateCounts
let latestYearlyData = {}; // NEW: Store yearly data for charts

// Define the fields for which we want to count '✔️'
const COUNT_FIELDS = [
    'is_offtopic', 'is_survey', 'is_through_hole', 'is_smt', 'is_x_ray', // Classification (Top-level)
    'features_tracks', 'features_holes', 'features_solder_insufficient', 'features_solder_excess',
    'features_solder_void', 'features_solder_crack', 'features_orientation', 'features_wrong_component',
    'features_missing_component', 'features_cosmetic', 'features_other_state', // Features (Nested under 'features')
    'technique_classic_cv_based', 'technique_ml_traditional',
    'technique_dl_cnn_classifier', 'technique_dl_cnn_detector', 'technique_dl_rcnn_detector',
    'technique_dl_transformer', 'technique_dl_other', 'technique_hybrid', 'technique_available_dataset', // Techniques (Nested under 'technique')
    'changed_by', 'verified', 'verified_by', 'user_comment_state' // Add these for user counting (Top-level)
];

// NEW: Define fields for techniques and features to track per year
const TECHNIQUE_FIELDS_FOR_YEARLY = [
    'technique_classic_cv_based', 'technique_ml_traditional',
    'technique_dl_cnn_classifier', 'technique_dl_cnn_detector', 'technique_dl_rcnn_detector',
    'technique_dl_transformer', 'technique_dl_other', 'technique_hybrid'
    // 'technique_available_dataset' is excluded from line chart per request
];
const FEATURE_FIELDS_FOR_YEARLY = [
    'features_tracks', 'features_holes', 'features_solder_insufficient', 'features_solder_excess',
    'features_solder_void', 'features_solder_crack', 'features_orientation', 'features_wrong_component',
    'features_missing_component', 'features_cosmetic', 'features_other_state'
];

function updateCounts() {
    const counts = {};
    // NEW: Initialize structures for yearly data
    const yearlySurveyImpl = {}; // { year: { surveys: count, impl: count } }
    const yearlyTechniques = {}; // { year: { technique_field: count, ... } }
    const yearlyFeatures = {};   // { year: { feature_field: count, ... } }
    const yearlyPubTypes = {}; // { year: { pubtype1: count, pubtype2: count, ... } }

    // Initialize counts for ALL status fields (including changed_by, verified_by)
    COUNT_FIELDS.forEach(field => counts[field] = 0);

    // Select only VISIBLE main rows for counting '✔️' and calculating visible count
    const visibleRows = document.querySelectorAll('#papersTable tbody tr[data-paper-id]:not(.filter-hidden)');
    const visiblePaperCount = visibleRows.length;

    visibleRows.forEach(row => {
        // --- Existing Counting Logic ---
        COUNT_FIELDS.forEach(field => {
            const cell = row.querySelector(`[data-field="${field}"]`);
            if (cell) {
                const cellText = cell.textContent.trim();
                if (field === 'changed_by' || field === 'verified_by') {
                    if (cellText === '👤') {
                        counts[field]++;
                    }
                } else {
                    if (cellText === '✔️') {
                        counts[field]++;
                    }
                }
            }
        });

        // --- NEW: Collect Yearly Data for Charts ---
        const yearCell = row.cells[2]; // Assuming Year is the 3rd column (index 2)
        const yearText = yearCell ? yearCell.textContent.trim() : '';
        const year = yearText ? parseInt(yearText, 10) : null;

        if (year && !isNaN(year)) {
            // Initialize yearly data objects for the year if they don't exist
            if (!yearlySurveyImpl[year]) {
                yearlySurveyImpl[year] = { surveys: 0, impl: 0 };
            }
            if (!yearlyTechniques[year]) {
                yearlyTechniques[year] = {};
                TECHNIQUE_FIELDS_FOR_YEARLY.forEach(f => yearlyTechniques[year][f] = 0);
            }
            if (!yearlyFeatures[year]) {
                yearlyFeatures[year] = {};
                FEATURE_FIELDS_FOR_YEARLY.forEach(f => yearlyFeatures[year][f] = 0);
            }

            const typeCell = row.cells[typeCellIndex]; // Assuming Type is the 1st column (index 0)
            const pubTypeText = typeCell ? typeCell.getAttribute('title') || typeCell.textContent.trim() : ''; // Use title for full type if available
            if (pubTypeText) {
                if (!yearlyPubTypes[year]) {
                    yearlyPubTypes[year] = {}; // Initialize object for this year's types
                }
                // Increment count for this type in this year
                yearlyPubTypes[year][pubTypeText] = (yearlyPubTypes[year][pubTypeText] || 0) + 1;
            }

            // Update Survey/Impl counts
            const isSurveyCell = row.querySelector('.editable-status[data-field="is_survey"]');
            const isSurvey = isSurveyCell && isSurveyCell.textContent.trim() === '✔️';
            if (isSurvey) {
                yearlySurveyImpl[year].surveys++;
            } else {
                yearlySurveyImpl[year].impl++;
            }

            // Update Technique counts
            TECHNIQUE_FIELDS_FOR_YEARLY.forEach(field => {
                const techCell = row.querySelector(`.editable-status[data-field="${field}"]`);
                if (techCell && techCell.textContent.trim() === '✔️') {
                    yearlyTechniques[year][field]++;
                }
            });

            // Update Feature counts
            FEATURE_FIELDS_FOR_YEARLY.forEach(field => {
                // const featCell = row.querySelector(`.editable-status[data-field="${field}"]`); //breaks "other" counts in chart, as it's a calculated, non-editable cell!
                const featCell = row.querySelector(`[data-field="${field}"]`);
                if (featCell && featCell.textContent.trim() === '✔️') {
                    yearlyFeatures[year][field]++;
                }
            });
        }
    });

    latestCounts = counts; // Make counts available outside this function
    // NEW: Make yearly data available
    latestYearlyData = {
        surveyImpl: yearlySurveyImpl,
        techniques: yearlyTechniques,
        features: yearlyFeatures,
        pubTypes: yearlyPubTypes // <-- Add this line
    };

    const allRows = document.querySelectorAll('#papersTable tbody tr[data-paper-id]');
    const totalPaperCount = allRows.length;
    latestCounts = counts; // Make counts available outside this function
    document.getElementById('visible-count-cell').innerHTML = `<strong>${visiblePaperCount}</strong> paper${visiblePaperCount !== 1 ? 's' : ''} of <strong>${totalPaperCount}</strong>`;
    COUNT_FIELDS.forEach(field => {
        const countCell = document.getElementById(`count-${field}`);
        if (countCell) {
            countCell.textContent = counts[field];
        }
    });
}

function applyAlternatingShading() {
    const visibleMainRows = document.querySelectorAll('#papersTable tbody tr[data-paper-id]:not(.filter-hidden)');
    visibleMainRows.forEach((mainRow, groupIndex) => {
        const shadeClass = (groupIndex % 2 === 0) ? 'alt-shade-1' : 'alt-shade-2';
        mainRow.classList.remove('alt-shade-1', 'alt-shade-2');
        mainRow.classList.add(shadeClass);
        mainRow.nextElementSibling.classList.remove('alt-shade-1', 'alt-shade-2');
        mainRow.nextElementSibling.classList.add(shadeClass);
    });
}

function sortTable() {
    document.documentElement.classList.add('busyCursor');

    setTimeout(() => {
        const sortBy = this.getAttribute('data-sort');
        if (!sortBy) return;

        let newDirection = 'DESC';
        if (currentClientSort.column === sortBy) {
            newDirection = currentClientSort.direction === 'DESC' ? 'ASC' : 'DESC';
        }
        const tbody = document.querySelector('#papersTable tbody');

        // --- PRE-PROCESS: Extract Sort Values and Row References ---
        const visibleMainRows = tbody.querySelectorAll('tr[data-paper-id]:not(.filter-hidden)');
        const headerIndex = Array.prototype.indexOf.call(this.parentNode.children, this);
        const sortData = [];
        let mainRow, paperId, cellValue, detailRow, cell;

        for (let i = 0; i < visibleMainRows.length; i++) {
            mainRow = visibleMainRows[i];
            paperId = mainRow.getAttribute('data-paper-id');

            // --- Extract cell value based on column type ---
            if (['title', 'year', 'journal', /*'authors',*/ 'page_count', 'estimated_score', 'relevance'].includes(sortBy)) {
                cell = mainRow.cells[headerIndex];
                cellValue = cell ? cell.textContent.trim() : '';
                if (sortBy === 'year' || sortBy === 'estimated_score' || sortBy === 'page_count' || sortBy === 'relevance') {
                    cellValue = parseFloat(cellValue) || 0;
                }
            } else if (['type', 'changed', 'changed_by', 'verified', 'verified_by', 'research_area', 'user_comment_state', 'features_other_state'].includes(sortBy)) {
                cell = mainRow.cells[headerIndex];
                cellValue = cell ? cell.textContent.trim() : '';
            } else { // Status/Feature/Technique columns
                cell = mainRow.querySelector(`.editable-status[data-field="${sortBy}"]`);
                // Use SYMBOL_SORT_WEIGHTS for sorting, defaulting to 0 if symbol not found
                cellValue = SYMBOL_SORT_WEIGHTS[cell?.textContent.trim()] ?? 0;
            }

            detailRow = mainRow.nextElementSibling; // Get the associated detail row
            sortData.push({ value: cellValue, mainRow, detailRow, paperId });
        }

        sortData.sort((a, b) => {
            let comparison = 0;
            if (a.value > b.value) comparison = 1;
            else if (a.value < b.value) comparison = -1;
            else {  // Secondary sort by paperId to ensure stable sort
                if (a.paperId > b.paperId) comparison = 1;
                else if (a.paperId < b.paperId) comparison = -1;
            }
            return newDirection === 'DESC' ? -comparison : comparison;
        });

        // --- BATCH UPDATE the DOM ---
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < sortData.length; i++) {
            fragment.appendChild(sortData[i].mainRow);
            fragment.appendChild(sortData[i].detailRow);
        }
        tbody.appendChild(fragment); // Single DOM append operation

        // --- Schedule UI Updates after DOM change ---
        // Use requestAnimationFrame to align with browser repaint
        requestAnimationFrame(() => {
            applyAlternatingShading();
            updateCounts();
        });
        currentClientSort = { column: sortBy, direction: newDirection };
        document.querySelectorAll('th .sort-indicator').forEach(ind => ind.textContent = '');
        const indicator = this.querySelector('.sort-indicator');
        if (indicator) {
            indicator.textContent = newDirection === 'ASC' ? '▲' : '▼';
        }
        // 3. Schedule removal of the busy cursor class AFTER a guaranteed delay
        // This ensures the CSS transition has time to play.
        // The delay (150ms) should be >= CSS transition duration (0.3s) + delay (0.1s) if you want full transition,
        // but even a shorter delay (longer than CSS delay) often works to trigger it.
        setTimeout(() => {
            document.documentElement.classList.remove('busyCursor');
        }, 150); // Delay slightly longer than CSS transition delay
    }, 20); // Initial defer for adding busy cursor (can keep this small or match rAF timing ~16ms)
}


const statsBtn = document.getElementById('static-stats-btn');
const modal = document.getElementById('statsModal');
const spanClose = document.querySelector('#statsModal .close');
const aboutBtn = document.getElementById('static-about-btn');
const modalSmall = document.getElementById('aboutModal');
const smallClose = document.querySelector('#aboutModal .close');

function calculateStats() {
    const stats = {
        journals: {},
        keywords: {},
        authors: {},
        researchAreas: {},
        otherDetectedFeatures: {}, // This line is crucial
        modelNames: {}             // This line is crucial
    };

    const visibleRows = document.querySelectorAll('#papersTable tbody tr[data-paper-id]:not(.filter-hidden)');
    visibleRows.forEach(row => {
        const journalCell = row.cells[3];
        if (journalCell) {
            const journal = journalCell.textContent.trim();
            if (journal) {
                stats.journals[journal] = (stats.journals[journal] || 0) + 1;
            }
        }
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
            const modelNameInput = detailRowForModelName.querySelector('.detail-edit input[name="model_name"]');
            if (modelNameInput) {
                const modelNameText = modelNameInput.value.trim();
                if (modelNameText) {
                    // Assuming model names might also be separated by ';' (adjust if needed)
                    const modelNamesList = modelNameText.split(';')
                        .map(m => m.trim())
                        .filter(m => m.length > 0);

                    modelNamesList.forEach(modelName => {
                        // Count occurrences of each model name string
                        stats.modelNames[modelName] = (stats.modelNames[modelName] || 0) + 1;
                    });
                }
            }
        }


    });
    return stats;
}

function displayStats() {

    updateCounts(); // Run updateCounts to get the latest data for visible rows

    // --- Define Consistent Colors for Techniques ---
    // Define the fixed color order used in the Techniques Distribution chart (sorted)
    const techniquesColors = [
        'hsla(347, 70%, 49%, 0.66)', // Red - Classic CV
        'hsla(204, 82%, 37%, 0.66)',  // Blue - Traditional ML
        'hsla(42, 100%, 37%, 0.66)',  // Yellow - CNN Classifier
        'hsla(180, 48%, 32%, 0.66)',  // Teal - CNN Detector
        'hsla(260, 80%, 50%, 0.66)', // Purple - R-CNN Detector
        'hsla(30, 100%, 43%, 0.66)',  // Orange - Transformer
        'hsla(0, 0%, 48%, 0.66)',  // Grey - Other DL
        'hsla(96, 100%, 29%, 0.66)', // Green - Hybrid
    ];
    const techniquesBorderColors = [
        'hsla(347, 70%, 29%, 1.00)',
        'hsla(204, 82%, 18%, 1.00)',
        'hsla(42, 100%, 18%, 1.00)',
        'hsla(180, 48%, 18%, 1.00)',
        'hsla(260, 100%, 30%, 1.00)',
        'hsla(30, 100%, 23%, 1.00)',
        'hsla(0, 0%, 28%, 1.00)',
        'hsla(147, 48%, 18%, 1.00)',
    ];

    // Map technique fields to their *original* color index in the unsorted list
    // IMPORTANT: This list must match the order of TECHNIQUE_FIELDS_FOR_YEARLY
    const TECHNIQUE_FIELDS_FOR_YEARLY = [
        'technique_classic_cv_based', 'technique_ml_traditional',
        'technique_dl_cnn_classifier', 'technique_dl_cnn_detector', 'technique_dl_rcnn_detector',
        'technique_dl_transformer', 'technique_dl_other', 'technique_hybrid'
    ];
    const TECHNIQUE_FIELD_COLOR_MAP = {};
    TECHNIQUE_FIELDS_FOR_YEARLY.forEach((field, index) => {
        TECHNIQUE_FIELD_COLOR_MAP[field] = index; // Map field to its original index
    });

    // --- Define Consistent Colors for Features ---
    // These are the original colors used in the Features Distribution chart (in original order)
    // Note: There are 10 features but only 4 distinct colors used.
    const featuresColorsOriginalOrder = [
        'hsla(180, 48%, 32%, 0.66)',    // 0 - PCB - Tracks (Teal)
        'hsla(180, 48%, 32%, 0.66)',    // 1 - PCB - Holes (Teal)
        'hsla(0, 0%, 48%, 0.66)',       // 2 - solder - Insufficient (Grey)
        'hsla(0, 0%, 48%, 0.66)',       // 3 - solder - Excess (Grey)
        'hsla(0, 0%, 48%, 0.66)',       // 4 - solder - Void (Grey)
        'hsla(0, 0%, 48%, 0.66)',       // 5 - solder - Crack (Grey)
        'hsla(347, 70%, 49%, 0.66)',    // 6 - PCBA - Orientation (Red)
        'hsla(347, 70%, 49%, 0.66)',    // 7 - PCBA - Missing Comp (Red)
        'hsla(347, 70%, 49%, 0.66)',    // 8 - PCBA - Wrong Comp (Red)
        'hsla(204, 82%, 37%, 0.66)',    // 9 - Cosmetic (Blue)
        'hsla(284, 82%, 37%, 0.66)',    // 10 - Other 
    ];
    const featuresBorderColorsOriginalOrder = [
        'hsla(204, 82%, 18%, 1.00)',    // 0 - PCB - Tracks
        'hsla(204, 82%, 18%, 1.00)',    // 1 - PCB - Holes
        'hsla(0, 0%, 28%, 1.00)',       // 2 - solder - Insufficient
        'hsla(0, 0%, 28%, 1.00)',       // 3 - solder - Excess
        'hsla(0, 0%, 28%, 1.00)',       // 4 - solder - Void
        'hsla(0, 0%, 28%, 1.00)',       // 5 - solder - Crack
        'hsla(347, 70%, 29%, 1.00)',    // 6 - PCBA - Orientation
        'hsla(347, 70%, 29%, 1.00)',    // 7 - PCBA - Missing Comp
        'hsla(347, 70%, 29%, 1.00)',    // 8 - PCBA - Wrong Comp
        'hsla(219, 100%, 30%, 1.00)',   // 9 - Cosmetic
        'hsla(284, 82%, 37%, 1.00)',    // 10 - Other 
    ];

    // Map feature fields to their *original* index in the unsorted list
    // IMPORTANT: This list must match the order of FEATURE_FIELDS_FOR_YEARLY
    const FEATURE_FIELDS_FOR_YEARLY = [
        'features_tracks', 'features_holes', 'features_solder_insufficient', 'features_solder_excess',
        'features_solder_void', 'features_solder_crack', 'features_orientation', 'features_wrong_component',
        'features_missing_component', 'features_cosmetic', 'features_other_state'
    ];
    const FEATURE_FIELD_INDEX_MAP = {};
    FEATURE_FIELDS_FOR_YEARLY.forEach((field, index) => {
        FEATURE_FIELD_INDEX_MAP[field] = index; // Map field to its original index
    });

    // --- Map Feature Fields to their Color Groups for Line Chart ---
    // Define the distinct color groups for the line chart based on original colors
    // The keys are the indices in the original color arrays that represent unique colors
    const featureColorGroups = {
        0: { label: 'PCB Features', fields: [] },      // Teal
        2: { label: 'Solder Defects', fields: [] },    // Grey
        6: { label: 'PCBA Issues', fields: [] },       // Red
        9: { label: 'Cosmetic', fields: [] },          // Blue
        10: { label: 'Other', fields: [] }
    };

    // Populate the groups with the actual feature fields
    FEATURE_FIELDS_FOR_YEARLY.forEach(field => {
        const originalIndex = FEATURE_FIELD_INDEX_MAP[field];
        const originalColorHSLA = featuresColorsOriginalOrder[originalIndex];

        // Find the base color index (0, 2, 6, 9) that matches this feature's color
        let baseColorIndex = null;
        for (let key in featureColorGroups) {
            const keyIndex = parseInt(key);
            if (featuresColorsOriginalOrder[keyIndex] === originalColorHSLA) {
                baseColorIndex = keyIndex;
                break;
            }
        }

        if (baseColorIndex !== null && featureColorGroups[baseColorIndex]) {
            featureColorGroups[baseColorIndex].fields.push(field);
        } else {
            console.warn(`Could not find matching base color for feature ${field}`);
        }
    });


    const FEATURE_FIELDS = [
        'features_tracks', 'features_holes', 'features_solder_insufficient',
        'features_solder_excess', 'features_solder_void', 'features_solder_crack',
        'features_orientation', 'features_missing_component', 'features_wrong_component',
        'features_cosmetic', 'features_other_state'
    ];
    // Include Datasets here temporarily to get the label mapping easily,
    // then filter it out for data/labels for the Techniques chart
    const TECHNIQUE_FIELDS_ALL = [
        'technique_classic_cv_based', 'technique_ml_traditional',
        'technique_dl_cnn_classifier', 'technique_dl_cnn_detector', 'technique_dl_rcnn_detector',
        'technique_dl_transformer', 'technique_dl_other', 'technique_hybrid',
        'technique_available_dataset' // Included to get label easily
    ];
    // Map NEW field names (data-field values / structure keys) to user-friendly labels (based on your table headers)
    const FIELD_LABELS = {
        // Features
        'features_tracks': 'Tracks',
        'features_holes': 'Holes',
        'features_solder_insufficient': 'Insufficient Solder',
        'features_solder_excess': 'Excess Solder',
        'features_solder_void': 'Solder Voids',
        'features_solder_crack': 'Solder Cracks',
        'features_orientation': 'Orientation/Polarity', // Combined as per previous logic
        'features_wrong_component': 'Wrong Component',
        'features_missing_component': 'Missing Component',
        'features_cosmetic': 'Cosmetic',
        'features_other_state': 'Other',
        // Techniques
        'technique_classic_cv_based': 'Classic CV',
        'technique_ml_traditional': 'Traditional ML',
        'technique_dl_cnn_classifier': 'CNN Classifier',
        'technique_dl_cnn_detector': 'CNN Detector',
        'technique_dl_rcnn_detector': 'R-CNN Detector',
        'technique_dl_transformer': 'Transformer',
        'technique_dl_other': 'Other DL',
        'technique_hybrid': 'Hybrid',
        'technique_available_dataset': 'Datasets' // Label for Datasets
    };


    // --- Read Counts from Footer Cells ---
    // We read the counts directly from the cells updated by updateCounts()
    function getCountFromFooter(fieldId) {
        const cell = document.getElementById(`count-${fieldId}`);
        if (cell) {
            const text = cell.textContent.trim();
            const number = parseInt(text, 10);
            return isNaN(number) ? 0 : number;
        }
        return 0;
    }

    // --- Prepare Features Distribution Chart Data (in original order) ---
    const featuresLabels = FEATURE_FIELDS.map(field => FIELD_LABELS[field] || field);
    const featuresValues = FEATURE_FIELDS.map(field => getCountFromFooter(field));

    const featuresChartData = {
        labels: featuresLabels,
        datasets: [{
            label: 'Features Count',
            data: featuresValues,
            backgroundColor: featuresColorsOriginalOrder, // Use original colors
            borderColor: featuresBorderColorsOriginalOrder, // Use original border colors
            borderWidth: 1,
            hoverOffset: 4
        }]
    };

    // --- Prepare Techniques Distribution Chart Data (Excluding Datasets count) ---
    const TECHNIQUE_FIELDS_NO_DATASET = TECHNIQUE_FIELDS_ALL.filter(field => field !== 'technique_available_dataset');
    // Read and sort the data for the distribution chart
    const techniquesData = TECHNIQUE_FIELDS_NO_DATASET.map(field => ({
        label: FIELD_LABELS[field] || field,
        value: getCountFromFooter(field),
        originalIndex: TECHNIQUE_FIELD_COLOR_MAP[field] !== undefined ? TECHNIQUE_FIELD_COLOR_MAP[field] : -1 // Get original color index
    }));
    // Sort by value descending (largest first) for the distribution chart display
    techniquesData.sort((a, b) => b.value - a.value);
    // Extract sorted labels and values
    const sortedTechniquesLabels = techniquesData.map(item => item.label);
    const sortedTechniquesValues = techniquesData.map(item => item.value);
    // Map the sorted order back to the original colors using the stored originalIndex
    const sortedTechniquesBackgroundColors = techniquesData.map(item => techniquesColors[item.originalIndex] || 'rgba(0,0,0,0.1)');
    const sortedTechniquesBorderColors = techniquesData.map(item => techniquesBorderColors[item.originalIndex] || 'rgba(0,0,0,1)');

    const techniquesChartData = {
        labels: sortedTechniquesLabels,
        datasets: [{
            label: 'Techniques Count',
            data: sortedTechniquesValues,
            backgroundColor: sortedTechniquesBackgroundColors, // Use mapped colors
            borderColor: sortedTechniquesBorderColors,         // Use mapped colors
            borderWidth: 1,
            hoverOffset: 4
        }]
    };

    // --- Destroy existing charts if they exist (important for re-renders) ---
    if (window.featuresPieChartInstance) {
        window.featuresPieChartInstance.destroy();
        delete window.featuresPieChartInstance;
    }
    if (window.techniquesPieChartInstance) {
        window.techniquesPieChartInstance.destroy();
        delete window.techniquesPieChartInstance;
    }
    if (window.surveyVsImplLineChartInstance) {
        window.surveyVsImplLineChartInstance.destroy();
        delete window.surveyVsImplLineChartInstance;
    }
    if (window.techniquesPerYearLineChartInstance) {
        window.techniquesPerYearLineChartInstance.destroy();
        delete window.techniquesPerYearLineChartInstance;
    }
    if (window.featuresPerYearLineChartInstance) {
        window.featuresPerYearLineChartInstance.destroy();
        delete window.featuresPerYearLineChartInstance;
    }


    
    // --- Get Canvas Contexts for ALL charts ---
    const featuresCtx = document.getElementById('featuresPieChart')?.getContext('2d');
    const techniquesCtx = document.getElementById('techniquesPieChart')?.getContext('2d');
    const surveyVsImplCtx = document.getElementById('surveyVsImplLineChart')?.getContext('2d');
    const techniquesPerYearCtx = document.getElementById('techniquesPerYearLineChart')?.getContext('2d');
    const featuresPerYearCtx = document.getElementById('featuresPerYearLineChart')?.getContext('2d');

    // --- Render Features Distribution Bar Chart (unchanged logic) ---
    if (featuresCtx) {
        window.featuresPieChartInstance = new Chart(featuresCtx, {
            type: 'bar',
            data: featuresChartData,
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return `${context.label}: ${context.raw}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: { precision: 0 }
                    }
                }
            }
        });
    } else {
        console.warn("Canvas context for featuresPieChart not found.");
    }

    // --- Render Techniques Distribution Bar Chart (using mapped colors) ---
    if (techniquesCtx) {
        window.techniquesPieChartInstance = new Chart(techniquesCtx, {
            type: 'bar',
            data: techniquesChartData, // Uses sortedTechniques* with mapped colors
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return `${context.label}: ${context.raw}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: { precision: 0 }
                    }
                }
            }
        });
    } else {
        console.warn("Canvas context for techniquesPieChart not found.");
    }

    // --- NEW: Render Line Charts ---

    // 1. Survey vs Implementation Papers per Year (unchanged)
    const surveyImplData = latestYearlyData.surveyImpl || {};
    const yearsForSurveyImpl = Object.keys(surveyImplData).map(Number).sort((a, b) => a - b);
    const surveyCounts = yearsForSurveyImpl.map(year => surveyImplData[year].surveys || 0);
    const implCounts = yearsForSurveyImpl.map(year => surveyImplData[year].impl || 0);

    if (surveyVsImplCtx) {
        window.surveyVsImplLineChartInstance = new Chart(surveyVsImplCtx, {
            type: 'line',
            data: {
                labels: yearsForSurveyImpl,
                datasets: [
                    {
                        label: 'Survey Papers',
                        data: surveyCounts,
                        borderColor: 'hsl(204, 82%, 37%)', // Blue
                        backgroundColor: 'hsla(204, 82%, 37%, 0.66)',
                        fill: false,
                        tension: 0.25
                    },
                    {
                        label: 'Implementation Papers',
                        data: implCounts,
                        borderColor: 'hsl(347, 70%, 49%)', // Red
                        backgroundColor: 'hsla(347, 70%, 49%, 0.66)',
                        fill: false,
                        tension: 0.25
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            usePointStyle: true,  // Use the point style
                            pointStyle: 'circle'  // Specify the circle style
                        }
                    },
                    title: { display: false, text: 'Survey vs Implementation Papers per Year' },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return `${context.dataset.label}: ${context.raw}`;
                            }
                        }
                    }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } },
                    x: { ticks: { precision: 0 } }
                }
            }
        });
    }

    // 2. Techniques per Year (Consistent Colors)
    const techniquesYearlyData = latestYearlyData.techniques || {};
    const yearsForTechniques = Object.keys(techniquesYearlyData).map(Number).sort((a, b) => a - b);

    // Create datasets for the line chart using the ORIGINAL field order and ORIGINAL colors
    // This ensures color consistency regardless of sorting in the bar chart
    const techniqueLineDatasets = TECHNIQUE_FIELDS_FOR_YEARLY.map(field => {
        const label = (typeof FIELD_LABELS !== 'undefined' && FIELD_LABELS[field]) ? FIELD_LABELS[field] : field;
        const data = yearsForTechniques.map(year => techniquesYearlyData[year]?.[field] || 0);
        // Use the ORIGINAL color index from the map
        const originalIndex = TECHNIQUE_FIELD_COLOR_MAP[field] !== undefined ? TECHNIQUE_FIELD_COLOR_MAP[field] : -1;
        const borderColor = (originalIndex !== -1 && techniquesColors[originalIndex]) ? techniquesColors[originalIndex] : 'rgba(0, 0, 0, 1)';
        const backgroundColor = (originalIndex !== -1 && techniquesColors[originalIndex]) ? techniquesColors[originalIndex] : 'rgba(0, 0, 0, 0.1)';
        return {
            label: label,
            data: data,
            borderColor: borderColor,       // Use original consistent color
            backgroundColor: backgroundColor, // Use original consistent color (often transparent for lines)
            fill: false,
            tension: 0.25
        };
    });

    if (techniquesPerYearCtx && techniqueLineDatasets.length > 0) {
        window.techniquesPerYearLineChartInstance = new Chart(techniquesPerYearCtx, {
            type: 'line',
            data: {
                labels: yearsForTechniques, // Use years sorted
                datasets: techniqueLineDatasets // Use datasets prepared with consistent colors
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            usePointStyle: true,  // Use the point style
                            pointStyle: 'circle'  // Specify the circle style
                        }
                    },
                    title: { display: false, text: 'Techniques per Year' },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return `${context.dataset.label}: ${context.raw}`;
                            }
                        }
                    }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } },
                    x: { ticks: { precision: 0 } }
                }
            }
        });
    } else if (techniquesPerYearCtx) {
        window.techniquesPerYearLineChartInstance = new Chart(techniquesPerYearCtx, {
            type: 'line',
            data: { labels: [], datasets: [] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: 'Techniques per Year (No Data)' }
                }
            }
        });
    }

    // 3. Features per Year (Summed by Color Group)
    const featuresYearlyData = latestYearlyData.features || {};
    const yearsForFeatures = Object.keys(featuresYearlyData).map(Number).sort((a, b) => a - b);

    // --- Create Aggregated Data by Color Group ---
    // Aggregate yearly data for each color group
    const aggregatedFeatureDataByColor = {};
    Object.keys(featureColorGroups).forEach(baseColorIndex => {
        const group = featureColorGroups[baseColorIndex];
        aggregatedFeatureDataByColor[group.label] = yearsForFeatures.map(year => {
            return group.fields.reduce((sum, field) => {
                return sum + (featuresYearlyData[year]?.[field] || 0);
            }, 0);
        });
    });

    // Create datasets for the line chart using the aggregated data and corresponding colors
    const featureLineDatasets = Object.keys(featureColorGroups).map(baseColorIndex => {
        const group = featureColorGroups[baseColorIndex];
        const colorIndex = parseInt(baseColorIndex); // Use the base color index to get the actual color
        const borderColor = (featuresColorsOriginalOrder[colorIndex]) ? featuresColorsOriginalOrder[colorIndex] : 'rgba(0, 0, 0, 1)';
        const backgroundColor = (featuresColorsOriginalOrder[colorIndex]) ? featuresColorsOriginalOrder[colorIndex] : 'rgba(0, 0, 0, 0.1)';
        return {
            label: group.label,
            data: aggregatedFeatureDataByColor[group.label],
            borderColor: borderColor,       // Use color corresponding to the group's base color
            backgroundColor: backgroundColor, // Use color corresponding to the group's base color
            fill: false,
            tension: 0.25
        };
    });

    if (featuresPerYearCtx && featureLineDatasets.length > 0) {
        window.featuresPerYearLineChartInstance = new Chart(featuresPerYearCtx, {
            type: 'line',
            data: {
                labels: yearsForFeatures, // Use years sorted
                datasets: featureLineDatasets // Use datasets prepared with aggregated data and consistent colors
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            usePointStyle: true,  // Use the point style
                            pointStyle: 'circle'  // Specify the circle style
                        }
                    },
                    title: { display: false, text: 'Features per Year' },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return `${context.dataset.label}: ${context.raw}`;
                            }
                        }
                    }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } },
                    x: { ticks: { precision: 0 } }
                }
            }
        });
    } else if (featuresPerYearCtx) {
        window.featuresPerYearLineChartInstance = new Chart(featuresPerYearCtx, {
            type: 'line',
            data: { labels: [], datasets: [] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: 'Features per Year (No Data)' }
                }
            }
        });
    }

    // --- 4. Publication Types per Year ---
    const pubTypesYearlyData = latestYearlyData.pubTypes || {};
    const yearsForPubTypes = Object.keys(pubTypesYearlyData).map(Number).sort((a, b) => a - b);

    // --- Aggregate data for the chart ---
    // Get all unique publication types across all years
    const allPubTypesSet = new Set();
    Object.values(pubTypesYearlyData).forEach(yearData => {
        Object.keys(yearData).forEach(type => allPubTypesSet.add(type));
    });
    const allPubTypes = Array.from(allPubTypesSet).sort(); // Sort for consistent legend order

    // Create datasets for the line chart, one for each publication type
    const pubTypeLineDatasets = allPubTypes.map((type, index) => {
        // Generate a distinct color for each type (simple hue rotation)
        // You might want to use a more sophisticated color palette
        const hue = (index * 137.508) % 360; // Golden angle approximation for spread
        const borderColor = `hsl(${hue}, 50%, 50%)`; 
        const backgroundColor = `hsla(${hue}, 60%, 45%, 0.5)`; 

        const data = yearsForPubTypes.map(year => pubTypesYearlyData[year]?.[type] || 0);
        return {
            label: type, // Use the raw type name as label (or map if needed)
            data: data,
            borderColor: borderColor,
            backgroundColor: backgroundColor,
            fill: false,
            tension: 0.25,
            hidden: false // Start visible
        };
    });

    // --- Render the Publication Types per Year Line Chart ---
    const pubTypesPerYearCtx = document.getElementById('pubTypesPerYearLineChart')?.getContext('2d');
    if (window.pubTypesPerYearLineChartInstance) {
        window.pubTypesPerYearLineChartInstance.destroy();
        delete window.pubTypesPerYearLineChartInstance;
    }

    if (pubTypesPerYearCtx && pubTypeLineDatasets.length > 0) {
        window.pubTypesPerYearLineChartInstance = new Chart(pubTypesPerYearCtx, {
            type: 'line',
            data: {
                labels: yearsForPubTypes, // Use sorted years
                datasets: pubTypeLineDatasets // Use datasets prepared above
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            usePointStyle: true,
                            pointStyle: 'circle'
                        }
                    },
                    title: { display: false, text: 'Publication Types per Year' },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return `${context.dataset.label}: ${context.raw}`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { precision: 0 },
                        title: {
                            display: true,
                            text: 'Count'
                        }
                    },
                    x: {
                        ticks: { precision: 0 },
                        title: {
                            display: false,
                            text: 'Year'
                        }
                    }
                }
            }
        });
    } else if (pubTypesPerYearCtx) {
        // Handle case where there's no data
        window.pubTypesPerYearLineChartInstance = new Chart(pubTypesPerYearCtx, {
            type: 'line',
            data: { labels: [], datasets: [] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: 'Publication Types per Year (No Data)' }
                }
            }
        });
    }
    const stats = calculateStats();

    // --- New Function Call to Populate Lists ---
    // Function to populate lists where items *can* appear only once (no > 1 filter)
    function populateSimpleList(listElementId, dataObj) {
        const listElement = document.getElementById(listElementId);
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
            listItem.innerHTML = `<span class="count">${count}</span> <span class="name">${escapedName}</span>`;
            listElement.appendChild(listItem);
        });
    }

    // Populate the new lists using the new helper function
    populateSimpleList('otherDetectedFeaturesStatsList', stats.otherDetectedFeatures);
    populateSimpleList('modelNamesStatsList', stats.modelNames);

    function populateList(listElementId, dataObj) {
        const listElement = document.getElementById(listElementId);
        listElement.innerHTML = '';
        const sortedEntries = Object.entries(dataObj)
            .filter(([name, count]) => count > 1)
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
            const escapedName = name.replace(/&/g, "&amp;").replace(/</g, "<").replace(/>/g, ">");
            listItem.innerHTML = `<span class="count">${count}</span> <span class="name">${escapedName}</span>`;
            listElement.appendChild(listItem);
        });
    }
    populateList('journalStatsList', stats.journals);
    populateList('keywordStatsList', stats.keywords);
    populateList('authorStatsList', stats.authors);
    populateList('researchAreaStatsList', stats.researchAreas);

    modal.offsetHeight;
    modal.classList.add('modal-active');
}

function displayAbout(){
    setTimeout(() => {
        modalSmall.offsetHeight;
        modalSmall.classList.add('modal-active');
    }, 20);
}
function closeModal() { modal.classList.remove('modal-active'); }
function closeSmallModal() { modalSmall.classList.remove('modal-active'); }


document.addEventListener('DOMContentLoaded', function () {

    searchInput.addEventListener('input', scheduleFilterUpdate);
    hideOfftopicCheckbox.addEventListener('change', scheduleFilterUpdate);
    minPageCountInput.addEventListener('input', scheduleFilterUpdate);
    minPageCountInput.addEventListener('change', scheduleFilterUpdate);
    yearFromInput.addEventListener('input', scheduleFilterUpdate);
    yearFromInput.addEventListener('change', scheduleFilterUpdate);
    yearToInput.addEventListener('input', scheduleFilterUpdate);
    yearToInput.addEventListener('change', scheduleFilterUpdate);
    hideXrayCheckbox.addEventListener('change', scheduleFilterUpdate);
    hideApprovedCheckbox.addEventListener('change', scheduleFilterUpdate);
    onlySurveyCheckbox.addEventListener('change', scheduleFilterUpdate);
    
    showPCBcheckbox.addEventListener('change', scheduleFilterUpdate);
    showSolderCheckbox.addEventListener('change', scheduleFilterUpdate);
    showPCBAcheckbox.addEventListener('change', scheduleFilterUpdate);

    headers.forEach(header => { header.addEventListener('click', sortTable); });
    statsBtn.addEventListener('click', function () {
        document.documentElement.classList.add('busyCursor');
        setTimeout(() => {
            displayStats();
            document.documentElement.classList.remove('busyCursor');
        }, 10);
    });
    aboutBtn.addEventListener('click', displayAbout);
    
    scheduleFilterUpdate();

    // --- Close Modal
    spanClose.addEventListener('click', closeModal);
    smallClose.addEventListener('click', closeSmallModal);
    document.addEventListener('keydown', function (event) {
        // Check if the pressed key is 'Escape' and if the modal is currently active
        if (event.key === 'Escape') { closeModal(); closeSmallModal(); }
    });
    window.addEventListener('click', function (event) {
        if (event.target === modal || event.target === modalSmall) { closeModal(); closeSmallModal(); }
    });

    setTimeout(() => {
        document.documentElement.classList.add('busyCursor');
        const commentedHeader = document.querySelector('th[data-sort="user_comment_state"]');
        // Set the initial sort state so the UI indicator is correct
        currentClientSort = { column: "user_comment_state", direction: 'DESC' };
        
        // Call sortTable with the correct 'this' context (the header element)
        // We need to bind 'this' or call it directly on the element
        sortTable.call(commentedHeader);

        // Update the sort indicator visually
        // Clear previous indicators
        document.querySelectorAll('th .sort-indicator').forEach(ind => ind.textContent = '');
        // Set the indicator on the target header
        const indicator = commentedHeader.querySelector('.sort-indicator');
        // Use '▼' for DESC, '▲' for ASC based on your sortTable logic
        indicator.textContent = currentClientSort.direction === 'ASC' ? '▲' : '▼';
        document.documentElement.classList.remove('busyCursor');
    }, 20); // Ensures it runs after applyLocalFilters' timeout finishes
});
```

```javascript
# static\stats.js

//stats.js
/** Stats-related Functionality **/

let latestCounts = {}; // This will store the counts calculated by updateCounts
let latestYearlyData = {}; // NEW: Store yearly data for charts

// Define the fields for which we want to count '✔️':
const COUNT_FIELDS = [
    'is_offtopic', 'is_survey', 'is_through_hole', 'is_smt', 'is_x_ray', // Classification (Top-level)
    'features_tracks', 'features_holes', 'features_solder_insufficient', 'features_solder_excess',
    'features_solder_void', 'features_solder_crack', 'features_orientation', 'features_wrong_component',
    'features_missing_component', 'features_cosmetic', 'features_other_state', // Features (Nested under 'features')
    'technique_classic_cv_based', 'technique_ml_traditional',
    'technique_dl_cnn_classifier', 'technique_dl_cnn_detector', 'technique_dl_rcnn_detector',
    'technique_dl_transformer', 'technique_dl_other', 'technique_hybrid', 'technique_available_dataset', // Techniques (Nested under 'technique')
    'changed_by', 'verified', 'verified_by', 'user_comment_state' // Add these for user counting (Top-level)
];

const statsBtn = document.getElementById('stats-btn');
const aboutBtn = document.getElementById('about-btn');
const modal = document.getElementById('statsModal');
const modalSmall = document.getElementById('aboutModal');
const spanClose = document.querySelector('#statsModal .close'); // Specific close button
const smallClose = document.querySelector('#aboutModal .close'); // Specific close button

// --- Define Consistent Colors for Techniques ---
// Define the fixed color order used in the Techniques Distribution chart (sorted)
const techniquesColors = [
    'hsla(347, 70%, 49%, 0.66)', // Red - Classic CV
    'hsla(204, 82%, 37%, 0.66)',  // Blue - Traditional ML
    'hsla(42, 100%, 37%, 0.66)',  // Yellow - CNN Classifier
    'hsla(180, 48%, 32%, 0.66)',  // Teal - CNN Detector
    'hsla(260, 80%, 50%, 0.66)', // Purple - R-CNN Detector
    'hsla(30, 100%, 43%, 0.66)',  // Orange - Transformer
    'hsla(0, 0%, 48%, 0.66)',  // Grey - Other DL
    'hsla(96, 100%, 29%, 0.66)', // Green - Hybrid
];
const techniquesBorderColors = [
    'hsla(347, 70%, 29%, 1.00)',
    'hsla(204, 82%, 18%, 1.00)',
    'hsla(42, 100%, 18%, 1.00)',
    'hsla(180, 48%, 18%, 1.00)',
    'hsla(260, 100%, 30%, 1.00)',
    'hsla(30, 100%, 23%, 1.00)',
    'hsla(0, 0%, 28%, 1.00)',
    'hsla(147, 48%, 18%, 1.00)',
];

// Map technique fields to their *original* color index in the unsorted list
// IMPORTANT: This list must match the order of TECHNIQUE_FIELDS_FOR_YEARLY
const TECHNIQUE_FIELDS_FOR_YEARLY = [
    'technique_classic_cv_based', 'technique_ml_traditional',
    'technique_dl_cnn_classifier', 'technique_dl_cnn_detector', 'technique_dl_rcnn_detector',
    'technique_dl_transformer', 'technique_dl_other', 'technique_hybrid'
];
const TECHNIQUE_FIELD_COLOR_MAP = {};

// --- Define Consistent Colors for Features ---
// These are the original colors used in the Features Distribution chart (in original order)
// Note: There are 10 features but only 4 distinct colors used.
const featuresColorsOriginalOrder = [
    'hsla(180, 48%, 32%, 0.66)',    // 0 - PCB - Tracks (Teal)
    'hsla(180, 48%, 32%, 0.66)',    // 1 - PCB - Holes (Teal)
    'hsla(0, 0%, 48%, 0.66)',       // 2 - solder - Insufficient (Grey)
    'hsla(0, 0%, 48%, 0.66)',       // 3 - solder - Excess (Grey)
    'hsla(0, 0%, 48%, 0.66)',       // 4 - solder - Void (Grey)
    'hsla(0, 0%, 48%, 0.66)',       // 5 - solder - Crack (Grey)
    'hsla(347, 70%, 49%, 0.66)',    // 6 - PCBA - Orientation (Red)
    'hsla(347, 70%, 49%, 0.66)',    // 7 - PCBA - Missing Comp (Red)
    'hsla(347, 70%, 49%, 0.66)',    // 8 - PCBA - Wrong Comp (Red)
    'hsla(204, 82%, 37%, 0.66)',    // 9 - Cosmetic (Blue)
    'hsla(284, 82%, 37%, 0.66)',    // 10 - Other 
];
const featuresBorderColorsOriginalOrder = [
    'hsla(204, 82%, 18%, 1.00)',    // 0 - PCB - Tracks
    'hsla(204, 82%, 18%, 1.00)',    // 1 - PCB - Holes
    'hsla(0, 0%, 28%, 1.00)',       // 2 - solder - Insufficient
    'hsla(0, 0%, 28%, 1.00)',       // 3 - solder - Excess
    'hsla(0, 0%, 28%, 1.00)',       // 4 - solder - Void
    'hsla(0, 0%, 28%, 1.00)',       // 5 - solder - Crack
    'hsla(347, 70%, 29%, 1.00)',    // 6 - PCBA - Orientation
    'hsla(347, 70%, 29%, 1.00)',    // 7 - PCBA - Missing Comp
    'hsla(347, 70%, 29%, 1.00)',    // 8 - PCBA - Wrong Comp
    'hsla(219, 100%, 30%, 1.00)',   // 9 - Cosmetic
    'hsla(284, 82%, 37%, 1.00)',    // 10 - Other 
];

// Map feature fields to their *original* index in the unsorted list
// IMPORTANT: This list must match the order of FEATURE_FIELDS_FOR_YEARLY
const FEATURE_FIELDS_FOR_YEARLY = [
    'features_tracks', 'features_holes', 'features_solder_insufficient', 'features_solder_excess',
    'features_solder_void', 'features_solder_crack', 'features_orientation', 'features_wrong_component',
    'features_missing_component', 'features_cosmetic', 'features_other_state'
];
const FEATURE_FIELD_INDEX_MAP = {};

const FEATURE_FIELDS = [
    'features_tracks', 'features_holes', 'features_solder_insufficient',
    'features_solder_excess', 'features_solder_void', 'features_solder_crack',
    'features_orientation', 'features_missing_component', 'features_wrong_component',
    'features_cosmetic', 'features_other_state'
];
// Include Datasets here temporarily to get the label mapping easily,
// then filter it out for data/labels for the Techniques chart
const TECHNIQUE_FIELDS_ALL = [
    'technique_classic_cv_based', 'technique_ml_traditional',
    'technique_dl_cnn_classifier', 'technique_dl_cnn_detector', 'technique_dl_rcnn_detector',
    'technique_dl_transformer', 'technique_dl_other', 'technique_hybrid',
    'technique_available_dataset' // Included to get label easily
];
// Map NEW field names (data-field values / structure keys) to user-friendly labels (based on your table headers)
const FIELD_LABELS = {
    // Features
    'features_tracks': 'Tracks',
    'features_holes': 'Holes',
    'features_solder_insufficient': 'Insufficient Solder',
    'features_solder_excess': 'Excess Solder',
    'features_solder_void': 'Solder Voids',
    'features_solder_crack': 'Solder Cracks',
    'features_orientation': 'Orientation/Polarity', // Combined as per previous logic
    'features_wrong_component': 'Wrong Component',
    'features_missing_component': 'Missing Component',
    'features_cosmetic': 'Cosmetic',
    'features_other_state': 'Other',
    // Techniques
    'technique_classic_cv_based': 'Classic CV',
    'technique_ml_traditional': 'Traditional ML',
    'technique_dl_cnn_classifier': 'CNN Classifier',
    'technique_dl_cnn_detector': 'CNN Detector',
    'technique_dl_rcnn_detector': 'R-CNN Detector',
    'technique_dl_transformer': 'Transformer',
    'technique_dl_other': 'Other DL',
    'technique_hybrid': 'Hybrid',
    'technique_available_dataset': 'Datasets' // Label for Datasets
};

// --- Map Feature Fields to their Color Groups for Line Chart ---
// Define the distinct color groups for the line chart based on original colors
// The keys are the indices in the original color arrays that represent unique colors
const featureColorGroups = {
    0: { label: 'PCB Features', fields: [] },      // Teal
    2: { label: 'Solder Defects', fields: [] },    // Grey
    6: { label: 'PCBA Issues', fields: [] },       // Red
    9: { label: 'Cosmetic', fields: [] },          // Blue
    10: { label: 'Other', fields: [] }
};

function displayStats() {
    
    document.documentElement.classList.add('busyCursor');
    setTimeout(() => {
        updateCounts(); // Run updateCounts to get the latest data for visible rows

        TECHNIQUE_FIELDS_FOR_YEARLY.forEach((field, index) => {
            TECHNIQUE_FIELD_COLOR_MAP[field] = index; // Map field to its original index
        });

        FEATURE_FIELDS_FOR_YEARLY.forEach((field, index) => {
            FEATURE_FIELD_INDEX_MAP[field] = index; // Map field to its original index
        });

        // Populate the groups with the actual feature fields
        FEATURE_FIELDS_FOR_YEARLY.forEach(field => {
            const originalIndex = FEATURE_FIELD_INDEX_MAP[field];
            const originalColorHSLA = featuresColorsOriginalOrder[originalIndex];

            // Find the base color index (0, 2, 6, 9) that matches this feature's color
            let baseColorIndex = null;
            for (let key in featureColorGroups) {
                const keyIndex = parseInt(key);
                if (featuresColorsOriginalOrder[keyIndex] === originalColorHSLA) {
                    baseColorIndex = keyIndex;
                    break;
                }
            }

            if (baseColorIndex !== null && featureColorGroups[baseColorIndex]) {
                featureColorGroups[baseColorIndex].fields.push(field);
            } else {
                console.warn(`Could not find matching base color for feature ${field}`);
            }
        });
        // --- Read Counts from Footer Cells ---
        // We read the counts directly from the cells updated by updateCounts()
        function getCountFromFooter(fieldId) {
            const cell = document.getElementById(`count-${fieldId}`);
            if (cell) {
                const text = cell.textContent.trim();
                const number = parseInt(text, 10);
                return isNaN(number) ? 0 : number;
            }
            return 0;
        }

        // --- Prepare Features Distribution Chart Data (in original order) ---
        const featuresLabels = FEATURE_FIELDS.map(field => FIELD_LABELS[field] || field);
        const featuresValues = FEATURE_FIELDS.map(field => getCountFromFooter(field));

        const featuresChartData = {
            labels: featuresLabels,
            datasets: [{
                label: 'Features Count',
                data: featuresValues,
                backgroundColor: featuresColorsOriginalOrder, // Use original colors
                borderColor: featuresBorderColorsOriginalOrder, // Use original border colors
                borderWidth: 1,
                hoverOffset: 4
            }]
        };

        // --- Prepare Techniques Distribution Chart Data (Excluding Datasets count) ---
        const TECHNIQUE_FIELDS_NO_DATASET = TECHNIQUE_FIELDS_ALL.filter(field => field !== 'technique_available_dataset');
        // Read and sort the data for the distribution chart
        const techniquesData = TECHNIQUE_FIELDS_NO_DATASET.map(field => ({
            label: FIELD_LABELS[field] || field,
            value: getCountFromFooter(field),
            originalIndex: TECHNIQUE_FIELD_COLOR_MAP[field] !== undefined ? TECHNIQUE_FIELD_COLOR_MAP[field] : -1 // Get original color index
        }));
        // Sort by value descending (largest first) for the distribution chart display
        techniquesData.sort((a, b) => b.value - a.value);
        // Extract sorted labels and values
        const sortedTechniquesLabels = techniquesData.map(item => item.label);
        const sortedTechniquesValues = techniquesData.map(item => item.value);
        // Map the sorted order back to the original colors using the stored originalIndex
        const sortedTechniquesBackgroundColors = techniquesData.map(item => techniquesColors[item.originalIndex] || 'rgba(0,0,0,0.1)');
        const sortedTechniquesBorderColors = techniquesData.map(item => techniquesBorderColors[item.originalIndex] || 'rgba(0,0,0,1)');

        const techniquesChartData = {
            labels: sortedTechniquesLabels,
            datasets: [{
                label: 'Techniques Count',
                data: sortedTechniquesValues,
                backgroundColor: sortedTechniquesBackgroundColors, // Use mapped colors
                borderColor: sortedTechniquesBorderColors,         // Use mapped colors
                borderWidth: 1,
                hoverOffset: 4
            }]
        };

        // --- Destroy existing charts if they exist (important for re-renders) ---
        if (window.featuresBarChartInstance) {
            window.featuresBarChartInstance.destroy();
            delete window.featuresBarChartInstance;
        }
        if (window.techniquesBarChartInstance) {
            window.techniquesBarChartInstance.destroy();
            delete window.techniquesBarChartInstance;
        }
        if (window.surveyVsImplLineChartInstance) {
            window.surveyVsImplLineChartInstance.destroy();
            delete window.surveyVsImplLineChartInstance;
        }
        if (window.techniquesPerYearLineChartInstance) {
            window.techniquesPerYearLineChartInstance.destroy();
            delete window.techniquesPerYearLineChartInstance;
        }
        if (window.featuresPerYearLineChartInstance) {
            window.featuresPerYearLineChartInstance.destroy();
            delete window.featuresPerYearLineChartInstance;
        }

        // --- Get Canvas Contexts for ALL charts ---
        const featuresCtx = document.getElementById('featuresPieChart')?.getContext('2d');
        const techniquesCtx = document.getElementById('techniquesPieChart')?.getContext('2d');
        const surveyVsImplCtx = document.getElementById('surveyVsImplLineChart')?.getContext('2d');
        const techniquesPerYearCtx = document.getElementById('techniquesPerYearLineChart')?.getContext('2d');
        const featuresPerYearCtx = document.getElementById('featuresPerYearLineChart')?.getContext('2d');

        // --- Render Features Distribution Bar Chart ---
        if (featuresCtx) {
            window.featuresBarChartInstance = new Chart(featuresCtx, {
                type: 'bar',
                data: featuresChartData,
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        title: { display: false },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    return `${context.label}: ${context.raw}`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            beginAtZero: true,
                            ticks: { precision: 0 }
                        }
                    }
                }
            });
        } else {
            console.warn("Canvas context for featuresPieChart not found.");
        }

        // --- Render Techniques Distribution Bar Chart (using mapped colors) ---
        if (techniquesCtx) {
            window.techniquesBarChartInstance = new Chart(techniquesCtx, {
                type: 'bar',
                data: techniquesChartData, // Uses sortedTechniques* with mapped colors
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        title: { display: false },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    return `${context.label}: ${context.raw}`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            beginAtZero: true,
                            ticks: { precision: 0 }
                        }
                    }
                }
            });
        } else {
            console.warn("Canvas context for techniquesPieChart not found.");
        }

        // --- Render Line Charts ---
        // 1. Survey vs Implementation Papers per Year
        const surveyImplData = latestYearlyData.surveyImpl || {};
        const yearsForSurveyImpl = Object.keys(surveyImplData).map(Number).sort((a, b) => a - b);
        const surveyCounts = yearsForSurveyImpl.map(year => surveyImplData[year].surveys || 0);
        const implCounts = yearsForSurveyImpl.map(year => surveyImplData[year].impl || 0);

        if (surveyVsImplCtx) {
            window.surveyVsImplLineChartInstance = new Chart(surveyVsImplCtx, {
                type: 'line',
                data: {
                    labels: yearsForSurveyImpl,
                    datasets: [
                        {
                            label: 'Survey Papers',
                            data: surveyCounts,
                            borderColor: 'hsl(204, 82%, 37%)', // Blue
                            backgroundColor: 'hsla(204, 82%, 37%, 0.66)',
                            fill: false,
                            tension: 0.25
                        },
                        {
                            label: 'Implementation Papers',
                            data: implCounts,
                            borderColor: 'hsl(347, 70%, 49%)', // Red
                            backgroundColor: 'hsla(347, 70%, 49%, 0.66)',
                            fill: false,
                            tension: 0.25
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: {
                                usePointStyle: true,  // Use the point style
                                pointStyle: 'circle'  // Specify the circle style
                            }
                        },
                        title: { display: false, text: 'Survey vs Implementation Papers per Year' },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    return `${context.dataset.label}: ${context.raw}`;
                                }
                            }
                        }
                    },
                    scales: {
                        y: { beginAtZero: true, ticks: { precision: 0 } },
                        x: { ticks: { precision: 0 } }
                    }
                }
            });
        }

        // 2. Techniques per Year (Consistent Colors)
        const techniquesYearlyData = latestYearlyData.techniques || {};
        const yearsForTechniques = Object.keys(techniquesYearlyData).map(Number).sort((a, b) => a - b);

        // Create datasets for the line chart using the ORIGINAL field order and ORIGINAL colors
        // This ensures color consistency regardless of sorting in the bar chart
        const techniqueLineDatasets = TECHNIQUE_FIELDS_FOR_YEARLY.map(field => {
            const label = (typeof FIELD_LABELS !== 'undefined' && FIELD_LABELS[field]) ? FIELD_LABELS[field] : field;
            const data = yearsForTechniques.map(year => techniquesYearlyData[year]?.[field] || 0);
            // Use the ORIGINAL color index from the map
            const originalIndex = TECHNIQUE_FIELD_COLOR_MAP[field] !== undefined ? TECHNIQUE_FIELD_COLOR_MAP[field] : -1;
            const borderColor = (originalIndex !== -1 && techniquesColors[originalIndex]) ? techniquesColors[originalIndex] : 'rgba(0, 0, 0, 1)';
            const backgroundColor = (originalIndex !== -1 && techniquesColors[originalIndex]) ? techniquesColors[originalIndex] : 'rgba(0, 0, 0, 0.1)';
            return {
                label: label,
                data: data,
                borderColor: borderColor,       // Use original consistent color
                backgroundColor: backgroundColor, // Use original consistent color (often transparent for lines)
                fill: false,
                tension: 0.25
            };
        });

        if (techniquesPerYearCtx && techniqueLineDatasets.length > 0) {
            window.techniquesPerYearLineChartInstance = new Chart(techniquesPerYearCtx, {
                type: 'line',
                data: {
                    labels: yearsForTechniques, // Use years sorted
                    datasets: techniqueLineDatasets // Use datasets prepared with consistent colors
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: {
                                usePointStyle: true,  // Use the point style
                                pointStyle: 'circle'  // Specify the circle style
                            }
                        },
                        title: { display: false, text: 'Techniques per Year' },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    return `${context.dataset.label}: ${context.raw}`;
                                }
                            }
                        }
                    },
                    scales: {
                        y: { beginAtZero: true, ticks: { precision: 0 } },
                        x: { ticks: { precision: 0 } }
                    }
                }
            });
        } else if (techniquesPerYearCtx) {
            window.techniquesPerYearLineChartInstance = new Chart(techniquesPerYearCtx, {
                type: 'line',
                data: { labels: [], datasets: [] },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        title: { display: true, text: 'Techniques per Year (No Data)' }
                    }
                }
            });
        }

        // 3. Features per Year (Summed by Color Group)
        const featuresYearlyData = latestYearlyData.features || {};
        const yearsForFeatures = Object.keys(featuresYearlyData).map(Number).sort((a, b) => a - b);

        // --- Create Aggregated Data by Color Group ---
        // Aggregate yearly data for each color group
        const aggregatedFeatureDataByColor = {};
        Object.keys(featureColorGroups).forEach(baseColorIndex => {
            const group = featureColorGroups[baseColorIndex];
            aggregatedFeatureDataByColor[group.label] = yearsForFeatures.map(year => {
                return group.fields.reduce((sum, field) => {
                    return sum + (featuresYearlyData[year]?.[field] || 0);
                }, 0);
            });
        });

        // Create datasets for the line chart using the aggregated data and corresponding colors
        const featureLineDatasets = Object.keys(featureColorGroups).map(baseColorIndex => {
            const group = featureColorGroups[baseColorIndex];
            const colorIndex = parseInt(baseColorIndex); // Use the base color index to get the actual color
            const borderColor = (featuresColorsOriginalOrder[colorIndex]) ? featuresColorsOriginalOrder[colorIndex] : 'rgba(0, 0, 0, 1)';
            const backgroundColor = (featuresColorsOriginalOrder[colorIndex]) ? featuresColorsOriginalOrder[colorIndex] : 'rgba(0, 0, 0, 0.1)';
            return {
                label: group.label,
                data: aggregatedFeatureDataByColor[group.label],
                borderColor: borderColor,       // Use color corresponding to the group's base color
                backgroundColor: backgroundColor, // Use color corresponding to the group's base color
                fill: false,
                tension: 0.25
            };
        });

        if (featuresPerYearCtx && featureLineDatasets.length > 0) {
            window.featuresPerYearLineChartInstance = new Chart(featuresPerYearCtx, {
                type: 'line',
                data: {
                    labels: yearsForFeatures, // Use years sorted
                    datasets: featureLineDatasets // Use datasets prepared with aggregated data and consistent colors
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: {
                                usePointStyle: true,  // Use the point style
                                pointStyle: 'circle'  // Specify the circle style
                            }
                        },
                        title: { display: false, text: 'Features per Year' },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    return `${context.dataset.label}: ${context.raw}`;
                                }
                            }
                        }
                    },
                    scales: {
                        y: { beginAtZero: true, ticks: { precision: 0 } },
                        x: { ticks: { precision: 0 } }
                    }
                }
            });
        } else if (featuresPerYearCtx) {
            window.featuresPerYearLineChartInstance = new Chart(featuresPerYearCtx, {
                type: 'line',
                data: { labels: [], datasets: [] },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        title: { display: true, text: 'Features per Year (No Data)' }
                    }
                }
            });
        }


        // --- 4. Publication Types per Year ---
        const pubTypesYearlyData = latestYearlyData.pubTypes || {};
        const yearsForPubTypes = Object.keys(pubTypesYearlyData).map(Number).sort((a, b) => a - b);

        // --- Aggregate data for the chart ---
        // Get all unique publication types across all years
        const allPubTypesSet = new Set();
        Object.values(pubTypesYearlyData).forEach(yearData => {
            Object.keys(yearData).forEach(type => allPubTypesSet.add(type));
        });
        const allPubTypes = Array.from(allPubTypesSet).sort(); // Sort for consistent legend order

        // Create datasets for the line chart, one for each publication type
        const pubTypeLineDatasets = allPubTypes.map((type, index) => {
            // Generate a distinct color for each type (simple hue rotation)
            // You might want to use a more sophisticated color palette
            const hue = (index * 137.508) % 360; // Golden angle approximation for spread
            const borderColor = `hsl(${hue}, 50%, 50%)`;
            const backgroundColor = `hsla(${hue}, 60%, 45%, 0.5)`; 

            const data = yearsForPubTypes.map(year => pubTypesYearlyData[year]?.[type] || 0);
            return {
                label: type, // Use the raw type name as label (or map if needed)
                data: data,
                borderColor: borderColor,
                backgroundColor: backgroundColor,
                fill: false,
                tension: 0.25,
                hidden: false // Start visible
            };
        });

        // --- Render the Publication Types per Year Line Chart ---
        const pubTypesPerYearCtx = document.getElementById('pubTypesPerYearLineChart')?.getContext('2d');
        if (window.pubTypesPerYearLineChartInstance) {
            window.pubTypesPerYearLineChartInstance.destroy();
            delete window.pubTypesPerYearLineChartInstance;
        }

        if (pubTypesPerYearCtx && pubTypeLineDatasets.length > 0) {
            window.pubTypesPerYearLineChartInstance = new Chart(pubTypesPerYearCtx, {
                type: 'line',
                data: {
                    labels: yearsForPubTypes, // Use sorted years
                    datasets: pubTypeLineDatasets // Use datasets prepared above
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: {
                                usePointStyle: true,
                                pointStyle: 'circle'
                            }
                        },
                        title: { display: false, text: 'Publication Types per Year' },
                        tooltip: {
                            callbacks: {
                                label: function (context) {
                                    return `${context.dataset.label}: ${context.raw}`;
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: { precision: 0 },
                            title: {
                                display: false,
                                text: 'Count'
                            }
                        },
                        x: {
                            ticks: { precision: 0 },
                            title: {
                                display: false,
                                text: 'Year'
                            }
                        }
                    }
                }
            });
        } else if (pubTypesPerYearCtx) {
            // Handle case where there's no data
            window.pubTypesPerYearLineChartInstance = new Chart(pubTypesPerYearCtx, {
                type: 'line',
                data: { labels: [], datasets: [] },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        title: { display: true, text: 'Publication Types per Year (No Data)' }
                    }
                }
            });
        }

        // --- 1. FETCH SERVER STATS  ---
        const urlParams = new URLSearchParams(window.location.search);
        const statsUrl = `/get_stats?${urlParams.toString()}`;
        fetch(statsUrl).then(response => {
            return response.json();
        }).then(data => {
            if (data.status === 'success' && data.data) {
                const statsData = data.data;
                function populateListFromServer(listElementId, dataArray) { //for items with count >=2
                    const listElement = document.getElementById(listElementId);
                    listElement.innerHTML = '';
                    if (!dataArray || dataArray.length === 0) {
                        listElement.innerHTML = '<li>No items with count > 1.</li>';
                        return;
                    }
                    dataArray.forEach(item => {
                        const listItem = document.createElement('li');
                        const escapedName = (item.name || '').toString()
                            .replace(/&/g, "&amp;").replace(/</g, "<")
                            .replace(/>/g, ">").replace(/"/g, "&quot;")
                            .replace(/'/g, "&#39;");
                        listItem.innerHTML = `<span class="count">${item.count}</span> <span class="name">${escapedName}</span>`;
                        listElement.appendChild(listItem);
                    });
                }
                populateListFromServer('journalStatsList', statsData.journals);
                populateListFromServer('keywordStatsList', statsData.keywords);
                populateListFromServer('authorStatsList', statsData.authors);
                populateListFromServer('researchAreaStatsList', statsData.research_areas);

                function populateAllListFromServer(listElementId, dataArray) { //for ALL items, not just repeating ones
                    const listElement = document.getElementById(listElementId);
                    listElement.innerHTML = '';
                    if (!dataArray || dataArray.length === 0) {
                        listElement.innerHTML = '<li>No non-empty items found.</li>';
                        return;
                    }
                    dataArray.forEach(item => {
                        const listItem = document.createElement('li');
                        const escapedName = (item.name || '').toString()
                            .replace(/&/g, "&amp;").replace(/</g, "<")
                            .replace(/>/g, ">").replace(/"/g, "&quot;")
                            .replace(/'/g, "&#39;");
                        // Use the same format for consistency
                        listItem.innerHTML = `<span class="count">${item.count}</span> <span class="name">${escapedName}</span>`;
                        listElement.appendChild(listItem);
                    });
                }
                populateAllListFromServer('otherDetectedFeaturesStatsList', statsData.other_features_all);
                populateAllListFromServer('modelNamesStatsList', statsData.model_names_all);

            }
        })


        // Trigger reflow to ensure styles are applied before adding the active class
        // This helps ensure the transition plays correctly on the first open
        modal.offsetHeight;
        // Add the active class to trigger the animation
        modal.classList.add('modal-active');

        setTimeout(() => {
            document.documentElement.classList.remove('busyCursor');
        }, 700); 
    }, 20);
}
function displayAbout(){
    setTimeout(() => {
        modalSmall.offsetHeight;
        modalSmall.classList.add('modal-active');
    }, 20);
}

function closeModal() { modal.classList.remove('modal-active'); }
function closeSmallModal() { modalSmall.classList.remove('modal-active'); }


document.addEventListener('DOMContentLoaded', function () {
    // Event Listeners for Stats Modal
    statsBtn.addEventListener('click', displayStats);
    aboutBtn.addEventListener('click', displayAbout);

    // --- Close Modal
    spanClose.addEventListener('click', closeModal);
    smallClose.addEventListener('click', closeSmallModal);
    document.addEventListener('keydown', function (event) {
        // Check if the pressed key is 'Escape' and if the modal is currently active
        if (event.key === 'Escape') { closeModal(); closeSmallModal(); closeBatchModal() }
    });
    window.addEventListener('click', function (event) {
        if (event.target === modal || event.target === modalSmall || event.target === batchModal) { closeModal(); closeSmallModal(); closeBatchModal() }
    });
});
```

```css
# static\style.css
@keyframes spin {
    0% {
        transform: rotate(0deg)
    }

    to {
        transform: rotate(360deg)
    }
}

:root {
    --text-color: #393939;
    --background-color: #f5f7fa;
    --table-row-even: #00000006;
    --table-row-odd: #0000;
    --highlighted-col-background: #bbccbb22;
    --primary-ui-color: hsl(188, 31%, 29%);
    --primary-ui-color-darker: hsl(188, 34%, 27%);
    --inferred-ui-color: hsl(154.6, 35.8%, 32.4%);
    --inferred-gradient-end-color: rgb(57, 106, 53);
    --stats-primary-ui-color: var(--primary-ui-color);
    --modal-wrapper-background: #eee6;
    --classify-btn-color: hsl(246, 29%, 40%);
    --verify-btn-color: hsl(276, 29%, 40%);
    --save-btn-color: #27ae60;
    --export-html-btn-color: rgb(54, 90, 145);
    --export-xlsx-btn-color: rgb(58, 136, 47);
    --light-colored-btn-color: rgb(185, 209, 209);
    --light-colored-btn-text: #0a5662;
    --dark-shadow: 1px 0 5px #0006;
    --light-shadow: 1px 0 5px #fff6;
    --th-border-color: #0000003b;
    --link-color: rgb(0, 45, 115);
    --detail-button-background: linear-gradient(180deg, hsl(210, 24%, 87%) 0%, hsl(210, 32%, 93%) 60%);
    --min-width: 1620px;
}

body {
    font-family: "Inter Tight",Arial,sans-serif;
    margin: 8px;
    background-color: var(--background-color);
    color: var(--text-color)
}

html.busyCursor body,html.busyCursor body * {
    cursor: wait
}

.loading-overlay {
    position: fixed;
    top: 58px;
    left: 9px;
    margin: 0;
    padding: 0;
    width: calc(100% - 18px);
    height: calc(100% - 67px);
    backdrop-filter: blur(12px);
    display: flex;
    justify-content: center;
    align-items: center;
    opacity: 0;
    pointer-events: none;
    transition: opacity .3s ease;
    transition-delay: .33s;
    border-radius: 8px;
    background: var(--modal-wrapper-background);
    flex-direction: column;
    gap: 40px;
}

html.busyCursor .loading-overlay {
    opacity: 1;
    pointer-events: all;
    transition-delay: .33s
}

.loading-spinner {
    width: 60px;
    height: 60px;
    border: 12px solid var(--primary-ui-color);
    border-top: 12px solid transparent;
    border-radius: 50%;
    animation: spin .75s linear infinite
}

.table-container {
    box-shadow: 0 2px 8px rgba(0,0,0,.35);
    border: 1px solid var(--primary-ui-color);
    overflow-y: auto;
    max-height: calc(100vh - 18px);
    position: relative;
    border-radius: 8px
}

h3,th {
    position: sticky;
    top: 0;
    text-shadow: var(--dark-shadow)
}

h3 {
    margin: 0;
    padding: 10px 0 10px 10px;
    background: var(--stats-primary-ui-color);
    color: #fefefe;
    display: inline-block;
    font-weight: 400;
    width: calc(100% - 10px);
    background: linear-gradient(180deg,var(--primary-ui-color) 50%,var(--primary-ui-color-darker) 100%)
}

table {
    border-collapse: collapse;
    width: 100%;
    background-color: #fff;
    min-width: var(--min-width);
    border-radius: 6px
}

td {
    padding: 9px 6px
}

th.rotate-header {
    white-space: nowrap;
    padding: 0
}


.header-branding{
    font-size: 24pt;
    justify-self: center;
    font-family: "Arial Narrow";
    font-weight: 400;
    color: #3f8d82;
    text-shadow: var(--light-shadow);
}


th.rotate-header>div {
    transform: rotate(-90deg) translateX(-40px);
    width: 32px;
    margin: 55px 0
}

th.rotate-header>div>span {
    display: block;
    text-align: left;
    max-height: 100px
}

th {
    vertical-align: bottom;
    background-color: var(--primary-ui-color);
    color: #fff;
    font-weight: 700;
    box-shadow: inset 0 0 0 .75px var(--th-border-color);
    padding: 6px;
    text-align: left;
    z-index: 10;
    font-size: 8.5pt
}

tr:nth-child(4) th:not(.inferred-header) {
    background: linear-gradient(180deg,var(--primary-ui-color) 50%,var(--primary-ui-color-darker) 100%)
}

th[data-sort]:hover {
    filter: contrast(1.25) brightness(.9);
    cursor: pointer
}

td.highlight-status {
    background: var(--highlighted-col-background)
}

.alt-shade-1,li:nth-child(even) {
    background-color: var(--table-row-even)
}

.alt-shade-2,li:nth-child(odd) {
    background-color: var(--table-row-odd)
}

.secondary-text-cell {
    font-size: 10pt;
    font-family: "Arial Narrow"
}

.detail-content {
    text-align: justify
}

.toggle-btn {
    cursor: pointer;
    text-decoration: none;
    color: #000b;
    background: var(--detail-button-background);
    font-size: 9.5pt;
    font-weight: 400;
    transition: filter .3s ease-in-out;
    text-align: center;
    box-shadow: inset 0 0 0 .5px #0006
}

.toggle-btn:hover {
    filter: saturate(200%) contrast(110%)
}

.sort-indicator {
    position: absolute;
    right: 8px;
    top: 36px;
    transform: translateY(-50%);
    font-size: .9em
}

input[type=search] {
    width: calc(100% - 4px);
    box-sizing: border-box;
    padding: 8px;
    border: 1px solid #0008;
    font-family: inherit;
    height: 42px;
    font-size: 11pt;
    font-style: italic;
    margin: 2px;
    color: #fff;
    background: #0000002a;
    -webkit-text-fill-color: #fff;
    -webkit-opacity: 1;
    opacity: .66;
    border-radius: 6px;
    transition: .25s all ease
}

input[type=search]:focus,input[type=search]:hover {
    opacity: 1;
    transition: .25s all ease
}

input[type=search]::-webkit-search-cancel-button,input[type=search]::-webkit-search-decoration,input[type=search]::-webkit-search-results-button,input[type=search]::-webkit-search-results-decoration {
    -webkit-appearance: none
}

input[type=search]::placeholder {
    color: rgba(255,255,255,.7);
    opacity: 1
}

input[type=search]::-webkit-input-placeholder {
    color: rgba(255,255,255,.7);
    opacity: 1
}

.filter-item input[type=number] {
    height: 28px;
    width: 55px;
    background: 0 0;
    color: #eee;
    font-size: 10.5pt;
    border: 0;
    padding: 3px 4px;
    margin: 0-18px 0 0;
    transition: .25s all ease;
    -moz-appearance: textfield;
    appearance: textfield;
    font-weight: 700
}

.filter-item input[type=number]:hover {
    background: #0002;
    border-radius: 3px;
    transition: .25s all ease;
    -moz-appearance: unset;
    appearance: unset;
    z-index: 9999
}

.action-btn {
    margin: 0 2px;
    /*! padding: 10px 20px; */
    background-color: var(--primary-ui-color);
    color: #fff;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11pt;
    transition: all .33s ease;
    box-shadow: 0 2px 4px rgba(0,0,0,.15);
    min-width: 160px;
    height: 40px;
    text-shadow: var(--dark-shadow);
    border: 1px solid #0002;
}

.action-btn:hover {
    filter: contrast(1.2) brightness(1.2);
    box-shadow: 0 3px 5px rgba(0,0,0,.15)
}

.action-btn:active {
    transform: translateY(1px);
    filter: contrast(1.2) brightness(.8);
    transition: all .1s ease
}

.action-btn:disabled {
    opacity: .5
}

.action-btn:disabled:hover {
    filter: unset;
    transform: unset
}

.action-btn:disabled:active {
    filter: unset
}

.edit-section {
    margin-top: 15px;
    padding-top: 15px
}

form label {
    display: block;
    font-weight: 700;
    line-height: 2em
}

form input[type=text] {
    margin-bottom: 10px
}

.changed-by-cell,.changed-cell {
    font-size: 9.5pt;
    color: #7f8c8d
}

.status-cell {
    text-align: center;
    font-size: 1.35em;
    padding: 1px;
    font-family: "Segoe UI Emoji Windows 11"
}

.editable-status,.editable-verify {
    cursor: pointer;
    transition: background-color .2s,transform .1s;
    border-radius: 3px;
    box-shadow: 0 1px 2px rgba(64,64,64,.1);
    -webkit-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
    user-select: none
}

.editable-status:hover,.editable-verify:hover {
    background-color: var(--light-colored-btn-color);
    transform: scale(1.1);
    box-shadow: 0 2px 4px rgba(0,0,0,.1)
}

.editable-status:active,.editable-verify:active {
    transform: scale(.95);
    background-color: var(--light-colored-btn-color)
}

.detail-flex-container {
    max-height: 0;
    overflow: hidden;
    transition: max-height .25s ease-in-out,opacity .3s ease-in-out;
    display: grid;
    grid-template-columns: 1fr 1fr 530px;
    grid-template-rows: auto;
    gap: 9px;
    box-sizing: border-box;
    width: 100%;
    padding: 0 0 0 10px;
    margin: 0
}

.detail-row.expanded .detail-flex-container {
    max-height: 3000px;
    opacity: 1;
    transition: max-height .5s ease-in-out,opacity .4s ease-in-out;
    border-bottom: 1px solid #e0e0e0
}

.detail-content {
    min-width: 0;
    box-sizing: border-box;
    padding: 4px
}

.detail-edit {
    min-width: 0;
    grid-column: 3/4;
    grid-row: 1/3
}

.detail-content p,.detail-edit p {
    text-align: justify;
    white-space: normal;
    margin-bottom: .5em;
    line-height: 1.3em
}

.detail-row>td {
    padding: 0
}

.detail-edit input[type=text] {
    padding: 6px;
    border: 1px solid #dadada;
    border-radius: 5px;
    font-family: inherit;
    font-size: 1em;
    background: #ffffffa0
}

.save-btn {
    background-color: var(--save-btn-color);
    width: 170px;
    font-weight: 700
}

#classify-all-btn,#classify-remaining-btn,.classify-btn {
    background: var(--classify-btn-color)
}

#verify-all-btn,#verify-remaining-btn,.verify-btn {
    background: var(--verify-btn-color)
}

#classify-all-btn strong,#verify-all-btn strong {
    text-decoration: underline
}

#export-html-btn,#import-bibtex-btn {
    min-width: 150px
}

#export-html-btn {
    background: var(--export-html-btn-color)
}

#export-xlsx-btn {
    background: var(--export-xlsx-btn-color)
}

#stats-btn {
    width: 160px;
    max-width: 160px;
    min-width: 160px;
    background: var(--stats-primary-ui-color);
}

#apply-serverside-filters, #static-stats-btn {
    background: var(--light-colored-btn-color);
    width: 125px;
    max-width: 125px;
    min-width: 125px;
    color: var(--light-colored-btn-text);
    font-size: 10pt;
    text-shadow: var(--light-shadow);
    transition: .2s all ease-in-out;
    padding: 0;
}

#static-about-btn {
    background: var(--light-colored-btn-color);
    color: var(--light-colored-btn-text);
    width: 30px;
    min-width: 30px;
    padding: 0;
}

#fullscreen-btn {
    background: 0 0;
    width: 28px;
    max-width: 28px;
    min-width: 28px;
    height: 36px;
    padding: 0;
    box-shadow: none;
    display: none
}

#about-btn {
    width: 30px;
    min-width: 30px;
    padding: 0
}

a {
    text-decoration: none;
    color: var(--link-color);
    font-weight: 400
}

th.inferred-header {
    background: var(--inferred-ui-color)
}

th.inferred-header-2 {
    filter: contrast(1.1) saturate(.95) hue-rotate(-16deg)
}

th.inferred-header-3 {
    filter: contrast(1.15) saturate(.95) hue-rotate(-36deg)
}

#inferred-header-title {
    background: linear-gradient(90deg,var(--inferred-ui-color),var(--inferred-gradient-end-color))
}

#inferred-header-title div, .inferred-header:not(.rotate-header) div {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    padding: 0 6px 0 0px;
    align-items: center;
}

.filter-item {
    white-space: nowrap
}

input[type=checkbox] {
    height: 12px;
    width: 12px;
    margin: 0;
    transform: scale(2,2) translate(1.5px,-.5px);
    border-radius: 0;
    opacity: .5
}

input[type=checkbox]:checked {
    opacity: 1;
    filter: hue-rotate(-50deg) brightness(1.3)
}

.filter-item label {
    margin-bottom: 0
}

tr.filter-hidden {
    display: none
}

#counts-footer {
    position: sticky;
    bottom: 0;
    z-index: 998;
    border-radius: 6px
}

#counts-footer tr {
    background-color: var(--primary-ui-color);
    color: #fff;
    font-weight: 700
}

#counts-footer td {
    text-align: center;
    font-size: 9pt;
    padding: 9px 0
}

.trace-content {
    white-space: pre-wrap;
    word-wrap: break-word;
    word-break: break-word;
    padding: 8px 12px;
    border: 1px solid #dadada;
    background-color: #aaaaaa0b;
    border-radius: 5px;
    height: 300px;
    overflow-y: auto;
    overflow-x: hidden;
    margin: 6px 0 10px;
    font-size: 10.5pt
}

.detail-evaluator-trace,.detail-verifier-trace {
    flex-basis: 100%;
    min-width: 100%
}

#main-header-wrapper {
    padding: 0
}

.main-header {
    display: grid;
    grid-template-columns: auto auto 1fr auto auto auto;
    grid-template-rows: auto;
    gap: 4px;
    align-items: center;
    background-color: #e0e6ed;
    box-shadow: 0 1px 3px rgba(0,0,0,.1);
    min-width: var(--min-width);
    height: 48px;
    background: var(--detail-button-background);
    border-radius: 8px 8px 0 0
}

.header-title h2 {
    margin: 0;
    color: #2c3e50;
    font-size: 1.5em
}

.header-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 15px;
    align-items: center;
    color: #eee;
    font-weight: 400;
    justify-content: space-between
}

.filter-item {
    display: inline-flex;
    align-items: center;
    padding: 5px;
    font-size: 10.5pt
}

#batch-status-message {
    font-size: 9.5pt
}

#batch-actions{
    z-index: 1000;
    overflow: auto;
    opacity: 1;
    /*! pointer-events: none; */
    transition-delay: 0s;
    display: flex;
    justify-content: center;
    align-items: center;
    position: fixed;
    top: 8px;
    right: 50px;
    background: var(--modal-wrapper-background);
    backdrop-filter: blur(16px);
    perspective: 100vh;
    flex-direction: column;
    padding: 10px;
    gap: 8px;
    border-radius: 8px;
    background: #f5f7fad9;
    border: 1.5px solid var(--stats-primary-ui-color);
    box-shadow: 0 16px 96px -0px rgba(0,0,0,.66);
    box-sizing: border-box;
    transform: scale3d(1,.75,1) translateY(-40px);
    transition: opacity .3s ease-in-out, transform .3s ease-out;
}

.header-controls {
    margin: 0 4px
}

.detail-edit {
    display: grid;
    height: 100%;
    padding: 0 12px 12px 0;
    box-sizing: border-box
}

.detail-edit form {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 90px;
    grid-template-rows: auto auto 1fr auto;
    gap: 10px;
    height: calc(100% - 16px)
}

.detail-edit form>label:nth-of-type(1) {
    grid-column: 1/3;
    grid-row: 1/2
}

.detail-edit form>label:nth-of-type(2) {
    grid-column: 3/5;
    grid-row: 1/2
}

.detail-edit form>label:nth-of-type(3) {
    grid-column: 1/3;
    grid-row: 2/3
}

.detail-edit form>label:nth-of-type(4) {
    grid-column: 3/4;
    grid-row: 2/3
}

.detail-edit form>label:nth-of-type(5) {
    grid-column: 4/5;
    grid-row: 2/3
}

.detail-edit input[type=text] {
    width: 100%;
    box-sizing: border-box
}

.detail-edit form>label:nth-of-type(6) {
    grid-column: 1/-1;
    grid-row: 3/4;
    display: flex;
    flex-direction: column
}

.detail-edit form textarea.editable {
    width: 100%;
    min-width: 100%;
    height: 100%;
    box-sizing: border-box;
    min-height: 150px;
    border-radius: 5px;
    display: block;
    resize: none;
    background: #ffffffa0;
    border: 1px solid #dadada
}

.detail-edit form>.row-actions {
    grid-column: 1/-1;
    grid-row: 4/5;
    text-align: left;
    display: flex;
    align-content: space-around;
    justify-content: space-between
}

.number-cell {
    text-align: center
}

.ontop-header {
    z-index: 100
}

.modal-content,.modal-small-content {
    background: linear-gradient(180deg,var(--stats-primary-ui-color) 0%,var(--stats-primary-ui-color) 20px,#f5f7fad9 20px);
    /*! border: 2px solid var(--stats-primary-ui-color); */
    border-radius: 8px;
    box-shadow: 0 16px 96px -0px rgba(0,0,0,.66);
    position: relative;
    box-sizing: border-box;
    overflow: hidden;
    transform: scale3d(.94,.94,1) rotate3d(2,1,0,2.5deg) translateY(-20px);
    transition: transform .3s ease-out;
    display: grid
}

.modal-content {
    width: calc(100vw - 180px);
    min-width: 1600px;
    height: calc(100vh - 20px);
    grid-template-columns: 540px 1fr;
}

.modal-small-content {
    width: 1080px;
    grid-template-columns: 4fr 2fr;
}

.modal-small-section h4,.modal-small-section p,.modal-small-section ul {
    padding: 0 18px
}

.close {
    color: #eee;
    float: right;
    font-size: 28px;
    font-weight: 700;
    position: absolute;
    right: 16px;
    top: 4px;
    cursor: pointer;
    z-index: 1001;
    text-shadow: var(--dark-shadow)
}

.close:focus,.close:hover {
    color: #fff;
    text-decoration: none
}

.stats-section ul {
    list-style-type: none;
    padding-left: 0;
    margin: 0;
    overflow: hidden
}

.stats-section li {
    padding: 4px 0;
    font-size: 9.5pt
}

.stats-section li span.count {
    font-weight: 700;
    min-width: 40px;
    display: inline-block;
    text-align: center
}

.stats-section p {
    padding: 0 10px;
    font-size: 10.5pt
}

.stats-list-multicolumn-short {
    column-count: 2;
    padding: 0 10px
}

.stats-list-multicolumn-2,.stats-list-multicolumn-short {
    column-gap: 0;
    break-inside: avoid-column
}

.stats-list-multicolumn li {
    break-inside: avoid
}

.modal {
    z-index: 1000;
    overflow: auto;
    opacity: 0;
    pointer-events: none;
    transition: opacity .25s ease-in-out;
    display: flex;
    justify-content: center;
    align-items: center;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: var(--modal-wrapper-background);
    backdrop-filter: blur(12px);
    perspective: 100vh
}

.modal p {
    text-align: justify
}

.modal.modal-active, #batch-actions.active {
    opacity: 1;
    pointer-events: auto;
    transition-delay: .5s
}

.modal.modal-active .modal-content,
.modal.modal-active .modal-small-content,
.modal.modal-active #batch-actions {
    transform: none;
    transition-delay: .4s
}

.stats-section {
    overflow-y: scroll;
    overflow-x: hidden
}

.stats-lists {
    display: grid;
    grid-template-rows: 1fr 1.5fr 1fr 90px 1fr 1fr;
    border-right: 2px solid var(--stats-primary-ui-color);
    flex: 1;
    min-height: 0
}

.stats-charts{
    display: grid;
    grid-template-columns: 152px 152px 1fr 1fr 1fr 1fr;
    grid-template-rows: calc(36vh - 6px) calc(36vh - 6px) calc(28vh - 8px);
}
.stats-charts .stats-section:nth-child(1) {
    grid-row: 1/2;
    grid-column: 1/3;
/*     height: calc(32vh - 10px); */
}
.stats-charts .stats-section:nth-child(2) {
    grid-row: 2/3;
    grid-column: 1/3;
/*     height: calc(32vh - 10px); */
}
.stats-charts .stats-section:nth-child(3) {
    grid-row: 3/4;
    grid-column: 1/4;
    height: calc(32vh - 10px);
}
.stats-charts .stats-section:nth-child(4) {
    grid-row: 1/2;
    grid-column: 3/7;
/*     height: calc(32vh - 10px); */
}
.stats-charts .stats-section:nth-child(5) {
    grid-row: 2/3;
    grid-column: 3/7;
/*     height: calc(32vh - 10px); */
    
}
.stats-charts .stats-section:nth-child(6) {
    grid-row: 3/4;
    grid-column: 4/7;
    height: calc(32vh - 10px);
    
}
@media screen and (max-width:1880px) {
    body {
        margin: 0
    }

    .table-container {
        max-height: calc(100vh);
        border-radius: 0;
        background: var(--primary-ui-color);
        border: 0
    }

    .loading-overlay {
        left: 0;
        width: calc(100%);
        height: calc(100%);
        border-radius: 0
    }

    .main-header {
        border-radius: 0
    }
    #batch-actions{
        top: 2px;
        right: 40px;
    }
}

::-webkit-scrollbar {
    width: 0;
    height: 0
}
```

```text
# static\style.css.old
/* static/style.css */


:root {
    --text-color: #393939;
    --background-color: #f5f7fa;
    --table-row-even: #00000006;
    --table-row-odd: #0000;
    --highlighted-col-background: #bbccbb22;
    /* --primary-ui-color: #2d6770; */
    /* --inferred-ui-color: hsl(170, 25%, 40%); */
    /* --inferred-gradient-end-color: rgb(77, 128, 92); */
    /* --primary-ui-color: #1f606a; */
    /* --primary-ui-color: #18616d; */
    /* --primary-ui-color-darker: #1f606a; */
    --primary-ui-color: hsl(188, 31%, 29%);
    --primary-ui-color-darker: hsl(188, 34%, 27%);
    --inferred-ui-color: hsl(154.6, 35.8%, 32.4%);
    --inferred-gradient-end-color: rgb(57, 106, 53);
    /* --stats-primary-ui-color:#1f606a; */
    --stats-primary-ui-color: var(--primary-ui-color-darker);
    --modal-wrapper-background: #eee6;
    --classify-btn-color:hsl(246, 29%, 40%);
    --verify-btn-color:hsl(276, 29%, 40%);
    --save-btn-color: #27ae60;
    --export-html-btn-color: rgb(54, 90, 145);
    --export-xlsx-btn-color: rgb(58, 136, 47);
    --light-colored-btn-color: rgb(185, 209, 209);
    --light-colored-btn-text: #0a5662;
    --dark-shadow: 1px 0 5px #0006;
    --light-shadow: 1px 0 5px #fff6;
    --th-border-color: #0000003b;
    --link-color: rgb(0, 45, 115);
    --detail-button-background: linear-gradient(180deg, hsl(210, 20%, 83%) 0%, hsl(210, 25%, 92%) 100%);
}

/* desaturated ver. */
/* :root {
    --text-color: #393939;
    --background-color: #f5f7fa;
    --table-row-even: #00000006;
    --table-row-odd: #0000;
    --highlighted-col-background: #bbccbb22;
    --primary-ui-color: #444E4A;
    --primary-ui-color-darker: #404A46;
    --inferred-ui-color: hsl(154.6, 25.8%, 32.4%);
    --inferred-gradient-end-color: rgb(66, 99, 63);
    --stats-primary-ui-color:#444E4A;
    --modal-wrapper-background: #eee6;
    --classify-btn-color:hsl(154.6, 35.8%, 32.4%);
    --verify-btn-color:rgb(57, 106, 53);
    --save-btn-color: #2f6546;
    --export-html-btn-color: rgb(57, 106, 53);
    --export-xlsx-btn-color: rgb(57, 106, 53);
    --light-colored-btn-color: rgb(185, 209, 209);
    --light-colored-btn-text: #0a5662;
    --dark-shadow: 1px 0 5px #0006;
    --light-shadow: 1px 0 5px #fff6;
    --th-border-color: #0000003b;
    --link-color: rgb(0, 45, 115);
    --detail-button-background: linear-gradient(180deg, hsl(180, 16%, 82.9%) 0%, hsl(210, 15%, 92%) 100%);
} */

body {
    font-family: "Inter Tight", Arial, sans-serif;
    margin: 8px;
    background-color: var(--background-color); 
    color: var(--text-color);
}

html.busyCursor body,
html.busyCursor body * {
    cursor: wait;
}
.table-container {
    position: relative;
}

.loading-overlay {
    position: fixed;
    top: 58px;
    left: 9px;
    margin: 0;
    padding: 0;
    width: calc(100% - 18px);
    height: calc(100% - 67px);
    backdrop-filter: blur(6px);
    display: flex;
    justify-content: center;
    align-items: center;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease;
    /* z-index: 1000; */
    transition-delay: 0.33s;  /*return transition*/
    border-radius: 8px;
    background: var(--modal-wrapper-background);
}

/* Only show spinner during filtering */
html.busyCursor .loading-overlay {
    opacity: 1;
    pointer-events: all;
    transition-delay: 0.33s; /*Start transition*/
}

.loading-spinner {
    width: 60px;
    height: 60px;
    border: 12px solid var(--primary-ui-color);
    border-top: 12px solid transparent;
    border-radius: 50%;
    animation: spin 0.75s linear infinite;
}

@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}


/* Ensure the table container allows internal scrolling for the sticky footer */
 .table-container { 
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
    border: 1px solid var(--primary-ui-color);
    overflow-y: auto; /* Allow vertical scrolling if needed */
    max-height: calc(100vh - 18px); 
    position: relative; /* Needed for sticky positioning within */
    border-radius: 8px;
}

h3 {
    margin: 0;
    padding: 10px 0 10px 10px;
    background: var(--stats-primary-ui-color);
    color: #fefefe;
    display: inline-block;
    font-weight: 400;
    position: sticky;
    top: 0;
    width: calc(100% - 10px);
    text-shadow: var(--dark-shadow);
    background: linear-gradient(180deg, var(--primary-ui-color) 50%, var(--primary-ui-color-darker) 100%);
}
table {
    border-collapse: collapse;
    width: 100%;
    background-color: #fff;
    min-width: 1580px;
    border-radius: 6px;
}

td {
    padding: 9px 6px; 
}

th.rotate-header {
    white-space: nowrap;
    padding: 0; 
}
th.rotate-header > div {
    transform: rotate(-90deg) translateX(-40px); 
    width: 32px; 
    margin: 55px 0; 
}
th.rotate-header > div > span {
    display: block;
    text-align: left;
    max-height: 100px;
}

th {
    vertical-align: bottom; 
    background-color: var(--primary-ui-color); 
    color: white;
    position: sticky;
    top:0;
    font-weight: bold;
    box-shadow: inset 0 -0px 0px 0.75px var(--th-border-color);
    padding: 6px;
    text-align: left;
    z-index: 10;
    font-size: 8.5pt;
    text-shadow: var(--dark-shadow);
/*     background: linear-gradient(180deg, var(--primary-ui-color), #1a545d); */
}

tr:nth-child(4) th:not(.inferred-header) {
    background: linear-gradient(180deg,var(--primary-ui-color) 50%, var(--primary-ui-color-darker) 100%);
}

th[data-sort]:hover {    
    filter: contrast(1.25) brightness(0.9); 
    cursor: pointer; 
}

td.highlight-status {
    background: var(--highlighted-col-background);
}
/* Add new classes for dynamic alternating shades */
.alt-shade-1, li:nth-child(even)  {
    background-color: var(--table-row-even); 
}

.alt-shade-2, li:nth-child(odd)  {
    background-color: var(--table-row-odd); 
}

.secondary-text-cell {
    font-size: 10pt;
    font-family: "Arial Narrow";
    /*! text-align: justify; */
}
.detail-content {
    /*! margin: 10px auto; */
    text-align: justify;
}

.toggle-btn {
    cursor: pointer;
    text-decoration: none;
    color: #000b;
    background: var(--detail-button-background);
    /*! border: 1px solid #0004; */
    font-size: 9.5pt;
    font-weight: 400;
    /*! border-top: 0; */
    transition: filter 0.3s ease-in-out;
    text-align: center;
    box-shadow: inset 0 -0px 0px 0.5px #0006;
}

.toggle-btn:hover {
    /* transition: 0.5s all ease-in-out; */
    filter: saturate(200%) contrast(110% );
}

.sort-indicator {
    position: absolute;
    right: 8px;
    top: 36px;
    transform: translateY(-50%);
    font-size: 0.9em;
}

/* .editable {
    padding: 4px;
    border-radius: 3px;
    transition: border-color 0.3s, box-shadow 0.3s;
} 

.editable:focus {
    border: 1px solid #3498db;
    outline: none;
    box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.2);
}*/

input[type="search"] {
    width: calc(100% - 4px);
    box-sizing: border-box;
    padding: 8px;
    border: 1px solid #0008;
    font-family: inherit; 
    height: 42px;
    font-size: 11pt;
    font-style: italic;
    margin: 2px;
    color: white; /* Ensure color is explicitly set */
    background: #0000002A; /* Ensure background is explicitly set */
    /* Add these vendor-prefixed properties to override Chromium defaults */
    -webkit-text-fill-color: white; /* Ensures text color inside the input */
    -webkit-opacity: 1; /* Override any potential opacity issues */
    opacity: 0.66;
    border-radius: 6px;
    transition: 0.25s all ease;
}
input[type="search"]:hover, input[type="search"]:focus  {
    opacity: 1;
    transition: 0.25s all ease;
}

/* Remove default Chromium search styling */
input[type="search"]::-webkit-search-decoration,
input[type="search"]::-webkit-search-cancel-button,
input[type="search"]::-webkit-search-results-button,
input[type="search"]::-webkit-search-results-decoration {
    -webkit-appearance: none; /* Removes default icons/buttons */
}

/* Ensure placeholder text is also styled correctly */
input[type="search"]::placeholder {
    color: rgba(255, 255, 255, 0.7); /* Adjust opacity as needed */
    opacity: 1; /* Override default opacity */
}
input[type="search"]::-webkit-input-placeholder { /* For older Webkit */
    color: rgba(255, 255, 255, 0.7);
    opacity: 1;
}
.filter-item input[type="number"] {
    height: 28px;
    width: 55px;
    background: transparent;
    color: #eee;
    font-size: 10.5pt;
    border: none;
    padding: 3px 4px;
    margin: 0px -18px 0 0;
    transition: 0.25s all ease;
    -moz-appearance: textfield;
    appearance: textfield;
    font-weight: bold;
}


.filter-item input[type="number"]:hover {
    background: #0002;
    /*! border: 1px solid #ccc; */ /* Add border */
    border-radius: 3px; /* Rounded corners */
    transition: 0.25s all ease;
    -moz-appearance: unset;
    appearance: unset;
    z-index:9999;
}

.action-btn {
    margin: 0 2px;
    padding: 10px 20px;
    background-color: var(--primary-ui-color); 
    color: white;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11pt;
    transition: all 0.33s ease;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
    min-width: 155px;
    height: 40px;
    text-shadow: var(--dark-shadow);
    border: 1px solid #0002;
}

.action-btn:hover {
    filter: contrast(1.2) brightness(1.2);
    box-shadow: 0 3px 5px rgba(0, 0, 0, 0.15);
}

.action-btn:active {
    transform: translateY(1px); 
    filter: contrast(1.2) brightness(0.8);
    transition: all 0.1s ease;
}

.action-btn:disabled {
    opacity: 0.5;
}

.action-btn:disabled:hover {
    filter: unset;
    transform: unset;
}

.action-btn:disabled:active {
    filter: unset;
}
.edit-section {
    margin-top: 15px;
    padding-top: 15px;
}
form label {
    display: block;
    /*! margin-bottom: 5px; */
    font-weight: bold;
    line-height: 2em;
}
form input[type="text"] {
    margin-bottom: 10px;
}

.changed-cell, .changed-by-cell {
    font-size: 9.5pt; 
    color: #7f8c8d; 
}

.status-cell{
    text-align: center;
    font-size: 1.35em;
    padding: 1px;    
    font-family: "Segoe UI Emoji Windows 11";
}


.editable-status, .editable-verify {
    cursor: pointer; 
    transition: background-color 0.2s, transform 0.1s; 
    border-radius: 3px; 
    box-shadow: 0 1px 2px rgba(64, 64, 64, 0.1);
    -webkit-user-select: none; /* Prevent text selection */
    -moz-user-select: none;
    -ms-user-select: none;
    user-select: none;
}
.editable-status:hover, .editable-verify:hover  {
    background-color: var(--light-colored-btn-color); 
    transform: scale(1.1);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}
.editable-status:active, .editable-verify:active  {
    transform: scale(0.95); 
    background-color: var(--light-colored-btn-color); 
}
.detail-flex-container {
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.25s ease-in-out, opacity 0.3s ease-in-out;
    
    display: grid;
    grid-template-columns: 1fr 1fr 530px;
    grid-template-rows: auto; 
    
    gap: 9px; 
    box-sizing: border-box;
    width: 100%;
    padding: 0 0 0 10px;
    margin: 0;
}

.detail-row.expanded .detail-flex-container {
    max-height: 3000px; 
    opacity: 1;
    transition: max-height 0.5s ease-in-out, opacity 0.4s ease-in-out;
    border-bottom: 1px solid #e0e0e0; 
}

.detail-content, .detail-edit {
    min-width: 0; 
    /*! padding: 10px; */
    box-sizing: border-box;
}

.detail-content p, .detail-edit p{
    text-align: justify; 
    white-space: normal;
    margin-bottom: 0.5em; 
}
.detail-row > td {
    padding: 0;
}

.detail-content, .detail-edit {
    min-width: 0;
    box-sizing: border-box;
    padding: 4px;
}

.detail-edit{
    grid-column: 3/4;
    grid-row: 1/3;
}
.detail-content p, .detail-edit p {
    text-align: justify;
    white-space: normal;
    margin-bottom: 0.5em;
    line-height: 1.3em;
}

.detail-edit input[type="text"] {
    width: 100%;
    /*! min-width: 150px; */
    box-sizing: border-box;
    padding: 6px;
    border: 1px solid #dadada;
    border-radius: 5px;
    font-family: inherit;
    font-size: 1em;
    background: #ffffffa0;
}
.save-btn {
    background-color: var(--save-btn-color);
    width: 170px;
    font-weight: bold;
}

#classify-remaining-btn, #classify-all-btn, .classify-btn {
    background: var(--classify-btn-color);
}

#verify-all-btn, #verify-remaining-btn, .verify-btn {
    background: var(--verify-btn-color);
}

#verify-all-btn strong, #classify-all-btn strong {
    text-decoration: underline;
}

#import-bibtex-btn, #export-html-btn{
    min-width: 150px;
}
#export-html-btn{
    background: var(--export-html-btn-color);
}
#export-xlsx-btn{
    background: var(--export-xlsx-btn-color);
}
#stats-btn {
    width: 130px;
    max-width: 130px;
    min-width: 130px;
    background:var(--stats-primary-ui-color);
}
#apply-serverside-filters, #static-stats-btn{
    background: var(--light-colored-btn-color);
    width: 120px;
    max-width: 120px;
    min-width: 120px;
    color: var(--light-colored-btn-text);
    font-size: 10.5pt;
    text-shadow: var(--light-shadow);
    transition: 0.2s all ease-in-out;
}
#fullscreen-btn {
    background: transparent;
    width: 28px;
    max-width: 28px;
    min-width: 28px;
    height: 36px;
    padding: 0;
    box-shadow: none;
    display: none;
}
#about-btn{
    width: 30px;
    min-width: 30px;
    padding: 0;
    /* background-color: #7a8081; */
}
a {
    text-decoration: none;
    color: var(--link-color);
    font-weight: 400;
}

th.inferred-header {
    background: var(--inferred-ui-color);
}
th.inferred-header-2 {
    filter: contrast(1.1) saturate(0.95) hue-rotate(-16deg);
}th.inferred-header-3 {
    filter: contrast(1.15) saturate(0.95) hue-rotate(-36deg);
}

#inferred-header-title{
    background: linear-gradient(90deg, var(--inferred-ui-color), var(--inferred-gradient-end-color));
}
#inferred-header-title div{
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    padding: 0 6px
}
/* --- Filter Item Styles --- */

.filter-item {
    display: inline-flex; /* Use flexbox for better alignment control */
    align-items: center;  /* Align items vertically in the center */
    white-space: nowrap;  /* Prevent wrapping within a single filter item */
    /* Add padding if needed for internal spacing */
    padding: 5px;
    font-size: 11pt;
}

input[type="checkbox"] {
    height: 12px;
    width: 12px;
    margin: 0;
    transform: scale(2,2) translate(1.5px,-0.5px);
    border-radius: 0;
    opacity: 0.5;
}
input[type="checkbox"]:checked {
    opacity: 1;
/*! filter: invert() hue-rotate(135deg); */
    filter: hue-rotate(-50deg) brightness(1.3);
    /* border: 2px solid white; */
    /*! border-radius: 2px; */
}

/* Optional: Adjust label alignment if needed */
.filter-item label {
    margin-bottom: 0; /* Override any default margin-bottom on labels */
    /* line-height can help align text with the checkbox if needed */
    /*! line-height: 1.5; */
}


/* --- Add this rule for filtering --- */
tr.filter-hidden {
    display: none;
}
/* --- End of new rule --- */


/* --- Sticky Footer Styles --- */
#counts-footer {
    position: sticky;
    bottom: 0;
    z-index: 998; /* Below header */
    border-radius: 6px;
}

#counts-footer tr {
    background-color: var(--primary-ui-color); /* Match header background */
    color: white;
    font-weight: bold;
}

#counts-footer td {
    text-align: center; /* Center the counts */
    /*! box-shadow: inset 0 -0px 0px 0.75px #0a5662; */ /* Match header border */
    font-size: 9pt;
     /* Match header min-width */
    padding: 9px 0px;
}


/* --- Styles for Reasoning Traces --- */

/* Container for the trace content within the detail row */
.trace-content {
    /* Preserves whitespace and line breaks like <pre> */
    white-space: pre-wrap;
    /* Allows long lines to wrap within the container */
    word-wrap: break-word; /* For older browser support, though word-break is often sufficient now */
    word-break: break-word; /* Breaks long words if necessary to fit container width */
    padding: 8px 12px;
    border: 1px solid #dadada;
    background-color: #aaaaaa0b;
    border-radius: 5px;
    height: 300px;
    overflow-y: auto;
    overflow-x: hidden;
    margin: 6px 0 10px 0;
    font-size: 10.5pt;
}

/* Ensures the trace container gets enough space in the flex/grid layout */
.detail-evaluator-trace,
.detail-verifier-trace {
    /* You might adjust flex-basis or width if needed, e.g., flex-basis: 100%; */
    /* For grid, you might need grid-column: span X; depending on your grid setup */
    /* Let's assume the parent flex container handles wrapping adequately for now */
    /* If traces need more specific sizing, add it here */
    flex-basis: 100%; /* Forces full width on new line(s) within flex container, adjust if needed */
    min-width: 100%; /* Allows the content to shrink below its intrinsic width if necessary */
}
#main-header-wrapper{
    padding: 0;
}
.main-header {
    /*! width: calc(100% - 30px); */
    display: grid;
    grid-template-columns: auto auto 1fr auto auto auto; /* Title, Filters, Controls */
    grid-template-rows: auto; /* Single row */
    gap: 4px; /* Space between items */
    align-items: center; /* Align items vertically */
    /*! padding: 0px 15px; */
    background-color: #e0e6ed; /* Example background */
    /* border: 1px solid #c0cacc; Example border */
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    min-width: 1580px;
    height: 48px;
    background: var(--detail-button-background);
    border-radius: 8px 8px 0 0;
}

.header-title h2 {
    margin: 0; /* Remove default margin */
    color: #2c3e50; /* Example text color */
    font-size: 1.5em; /* Adjust title size if needed */
}

.header-filters {
    display: flex;
    flex-wrap: wrap; /* Allow items to wrap if needed */
    gap: 15px; /* Space between filter items */
    align-items: center; /* Align items vertically */
    /* Optional: justify-content: center; or space-between; */
    color: #eee;
    font-weight: 400;  
    justify-content: space-between;
}

.filter-item {
    display: inline-flex; /* Keep flex for alignment */
    align-items: center;  /* Align items vertically */
    /*! white-space: nowrap; */  /* Prevent wrapping within a single filter item */
    padding: 5px; /* Keep padding */
    font-size: 10.5pt; /* Keep font size */
    /* background: #f0f0f0; */ /* Optional background for filter items */
    /* border-radius: 4px; */ /* Optional rounded corners */
}

#batch-status-message {
    font-size: 9.5pt;
}




.header-controls{
    margin: 0 4px;
}







/* --- ONLY Modifications within .detail-edit using Grid --- */

/* Ensure the edit section itself can participate in layout correctly */
/* It's already positioned by the parent grid, so focus on internal layout */
.detail-edit {
    /* Make .detail-edit itself a grid container for its direct children (form) */
    /* Or, make the form the grid container. Let's do that for cleaner structure. */
    /* Ensure it takes the height allocated by the parent grid */
    display: grid; /* Make it a grid if needed, but content dictates size */
    height: 100%; /* Take full height of its grid cell */
    padding: 0 12px 12px 0;
    box-sizing: border-box;
}

/* --- Make the form the Grid Container --- */
.detail-edit form {
    display: grid;
    /* Define explicit columns for the inputs/areas */
    /* Two columns for the first row (Research Area, Model Name) */
    /* One column for the full-width items below (Other, Page Count, Comments) */
    /* One row for the top inputs, one for the expanding comments, one for buttons */
    grid-template-columns: 1fr 1fr 1fr 90px; /* Two equal flexible columns */
    grid-template-rows: auto auto 1fr auto; /* Rows: labels, labels, textarea, buttons */
    gap: 10px; /* Consistent gap between grid items */
    height: calc(100% - 16px); /* Fill the .detail-edit area */
}

/* --- Place Research Area and Model Name on the first grid line --- */
/* Target the first two labels directly */
.detail-edit form > label:nth-of-type(1) { /* Research Area */
    grid-column: 1 / 3;
    grid-row: 1 / 2;
}
.detail-edit form > label:nth-of-type(2) { /* Model Name */
    grid-column: 3 / 5;
    grid-row: 1 / 2;
}

/* --- Place Other Defects and Page Count on the second grid line --- */
.detail-edit form > label:nth-of-type(3) { /* Other Defects */
    grid-column: 1 / 3;
    grid-row: 2 / 3;
}
.detail-edit form > label:nth-of-type(4) { /* Page Count */
    grid-column: 3 / 4;
    grid-row: 2 / 3;
}
.detail-edit form > label:nth-of-type(5) { /* Relevance */
    grid-column: 4 / 5;
    grid-row: 2 / 3;
}
/* --- Ensure inputs within these labels expand to fill their grid cells --- */
/* .detail-edit form > label:nth-of-type(1) > input[type="text"],
.detail-edit form > label:nth-of-type(2) > input[type="text"],
.detail-edit form > label:nth-of-type(3) > input[type="text"],
.detail-edit form > label:nth-of-type(4) > input[type="text"], */
.detail-edit input[type="text"]  {
    width: 100%;
    box-sizing: border-box;
}


/* --- Make User Comments Textarea Expand --- */
/* Target the label containing the textarea */
.detail-edit form > label:nth-of-type(6) { 
    /* Span both columns */
    grid-column: 1 / -1; /* From column 1 to the end */
    /* Place it in the row designed for the expanding content */
    grid-row: 3 / 4;
    /* Make this label itself a flex column to manage the textarea inside */
    display: flex;
    flex-direction: column;
}
/* Make the textarea itself expand to fill the label's grid cell */
.detail-edit form textarea.editable {
    /* flex-grow: 1; /* Expand within the flex label */
    width: 100%;
    min-width: 100%;
    /* Make the textarea fill the label's grid cell */
    height: 100%; /* Use 100% height managed by grid/flex parent */
    box-sizing: border-box;
    /* Remove any fixed height from global styles if conflicting */
    /* height: auto; /* Let grid handle height */
    min-height: 150px; /* Optional: Set a minimum height */
    border-radius: 5px;
    display: block;
    resize: none;
    background: #ffffffa0; /* /* Allow user to resize vertically if needed */
    border: 1px solid #dadada;
}

.detail-edit form > .row-actions {
    /* Span both columns */
    grid-column: 1 / -1;
    /* Place it in the last row */
    grid-row: 4 / 5;
    /* Optional: Align buttons */
    text-align: left; /* Or use flexbox/grid inside .row-actions for button layout */
    display: flex;
    align-content: space-around;
    justify-content: space-between;
}

.number-cell {
    text-align: center;
}


.ontop-header {
    z-index: 100
}

.modal-content {
    background: linear-gradient(180deg, var(--stats-primary-ui-color) 0%, var(--stats-primary-ui-color) 20px, #f5f7fad9 20px);
     /* 5vh top/bottom margin */
    border: 2px solid var(--stats-primary-ui-color);
    width: calc(100vw - 180px);
    min-width: 1600px;
    height: calc(100vh - 20px); /* Limit height */
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    position: relative;
    box-sizing: border-box; /* Include padding/border in width/height */
    overflow: hidden;
    /*! transform: scale(95%) translateY(-20px); */
    
    transform: scale3d(0.94, 0.94, 1) rotate3d(2, 1, 0, 2.5deg) translateY(-20px);
    transition: transform 0.3s ease-out; /* Animate transform */
    display: grid;
    grid-template-columns: 540px 305px 1fr;
}

.modal-small-content {
    background: linear-gradient(180deg, var(--stats-primary-ui-color) 0%, var(--stats-primary-ui-color) 20px, #f5f7fad9 20px);
    border: 2px solid var(--stats-primary-ui-color);
    width: 1200px;
    /*! height: 800px; */
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    position: relative;
    box-sizing: border-box; /* Include padding/border in width/height */
    overflow: hidden;
    transform: scale3d(0.94, 0.94, 1) rotate3d(2, 1, 0, 2.5deg) translateY(-20px);
    transition: transform 0.3s ease-out; 
    /*! min-height: 800px; */
    display: grid;
    grid-template-columns: 3fr 1fr;
}
.modal-small-section p, .modal-small-section ul, .modal-small-section h4  {
    padding: 0 16px;
}


.close {
    color: #eee;
    float: right;
    font-size: 28px;
    font-weight: bold;
    position: absolute;
    right: 16px;
    top: 4px;
    cursor: pointer;
    z-index: 1001; /* Above content */
    text-shadow: var(--dark-shadow);
}

.close:hover,
.close:focus {
    color: white;
    text-decoration: none;
}


.stats-section ul {
    list-style-type: none;
    padding-left: 0;
    margin: 0;
    overflow: hidden;
}

.stats-section li {
    padding: 4px 0;
    font-size: 9.5pt;
    /*! display: flex; */
    /*! justify-content: ; */ /* Align count to the right */
    /*! flex-direction: row; */
    /*! flex-wrap: wrap; */
    /*! text-align: right; */
}

.stats-section li span.count {
    font-weight: bold;
    min-width: 40px; /* Ensure consistent spacing for counts */
    display: inline-block;
    text-align: center;
}
.stats-section p {
    padding: 0 10px;
    /*! text-align: right; */
    /*! width: calc(100% - 350px); */
    /*! color: #eee; */
    font-size: 10.5pt;
}

/* Add this rule inside static/style.css */

/* --- Styles for Multi-Column Stats List --- */
.stats-list-multicolumn-short {
    /* Use CSS Columns */
    column-count: 2;
    column-gap: 0px; /* Adjust gap between columns as needed */
    /* Ensure list items don't break across columns awkwardly */
    break-inside: avoid-column;
    /* Optional: Add a small padding if the columns feel too close to the edge */
    padding: 0 10px;
}

/* --- Styles for Multi-Column Stats List --- */
.stats-list-multicolumn-2 {
    /* Use CSS Columns */
    /*! column-count: 1; */
    column-gap: 0px; /* Adjust gap between columns as needed */
    /* Ensure list items don't break across columns awkwardly */
    break-inside: avoid-column;
    /* Optional: Add a small padding if the columns feel too close to the edge */
    /*! padding: 0 10px; */
}
/* Ensure list items behave well within the multi-column layout */
.stats-list-multicolumn li {
    /* Each <li> should try to stay together */
    break-inside: avoid;
    /* Optional: Add a bit of vertical padding if items feel cramped */
    /* padding: 2px 0; */
}

/* --- Stats Modal Styles --- */
.modal {
     /* Hidden by default */
    z-index: 1000; /* Sit on top */
    overflow: auto; /* Enable scroll if needed */
     /* Semi-transparent background */
     /* Optional: blur background */
    opacity: 0; /* Start fully transparent */
    pointer-events: none; /* Ignore mouse events when hidden */
    transition: opacity 0.3s ease-in-out; /* Animate opacity */
    /* transition-delay: 0.15s; */
    display: flex;
    justify-content: center;
    align-items: center;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: var(--modal-wrapper-background);
    backdrop-filter: blur(12px);
    perspective: 100vh;
}
.modal p {
    text-align: justify;
}

/* When the modal is active/shown */
.modal.modal-active {
    opacity: 1; /* Fully opaque */
    pointer-events: auto; /* Enable mouse events */
    /* Keep the existing backdrop styles */
    transition-delay: 0.5s;
}
/* When the modal is active, move it to its final position */
.modal.modal-active .modal-content, .modal.modal-active .modal-small-content  {
    transform: none; /* Final position */
    transition-delay: 0.5s;
}
/* --- End Stats Modal Animation Styles --- */

.stats-section {
    overflow-y: scroll;
    overflow-x: hidden;
}
.stats-lists {
    display: grid;
    grid-template-rows: 1fr 1.5fr 1fr 90px 1fr 1fr;
    border-right: 2px solid var(--stats-primary-ui-color);
    flex: 1; /* Take remaining space */
    min-height: 0; /* Prevent overflow */
}

@media screen and (max-width: 1880px) {
    body {
        margin: 0px;
    }

    .table-container { 
        max-height: calc(100vh);
        border-radius: 0px;
        background: var(--primary-ui-color);
        border: none;
    }
        
    .loading-overlay {
        left: 0px;
        width: calc(100%);
        height: calc(100%);
        border-radius: 0px;
    }
        
    .main-header {
        border-radius: 0;
    }
}
::-webkit-scrollbar { /* WebKit */
    width: 0;
    height: 0;
}
```

```html
# templates\detail_row.html
<!-- templates/detail_row.html -->
{% block detail_row_content %}
<div class="detail-flex-container">
    <div class="detail-content detail-abstract">
        <p><strong>Abstract:</strong> {{ paper.abstract }}</p>
    </div>
    <div class="detail-content detail-metadata">
        <p><strong>Keywords:</strong> {{ paper.keywords }}</p>
        <p><strong>Type:</strong> {{ paper.type }}</p>
        <p><strong>DOI:</strong>
            {% if paper.doi %}
                <a href="https://doi.org/{{ paper.doi }}" target="_blank">{{ paper.doi }}</a>
            {% else %}
                {{ paper.doi }}
            {% endif %}
        </p>
        <p><strong>ISSN:</strong> {{ paper.issn }}</p>
        <p><strong>Pages:</strong> {{ paper.pages }}</p>
        <p><strong>ID:</strong> {{ paper.id }}</p> <!-- Show ID in details -->
        <p><strong>Full Authors:</strong> {{ paper.authors }}</p> <!-- Show full authors in details -->
        <p><strong>Year:</strong> {{ paper.year }}</p>
    </div>
    <div class="edit-section detail-edit">
        <form id="form-{{ paper.id }}" data-paper-id="{{ paper.id }}">
            <label>Research Area:
                <input type="text" class="editable" name="research_area" value="{{ paper.research_area or '' }}">
            </label>
            <label>Model Name:
                <input type="text" class="editable" name="model_name" value="{{ paper.technique.model or '' }}">
            </label>
            <label>Other defects:
                <input type="text" class="editable" name="features_other" value="{{ paper.features.other or '' }}">
            </label>
            <label>Page count:
                <input type="text" class="editable" name="page_count" value="{{ paper.page_count or '' }}">
            </label>
            <label>Relevance:
                <input type="text" class="editable" name="relevance" value="{{ paper.relevance or '' }}" placeholder="0 - 10">
            </label>
            <label>User comments:
                <textarea class="editable" name="user_trace">{{ paper.user_trace or '' }}</textarea>
            </label>
            <!-- NEW: Per-Row Action Buttons -->
            <div class="row-actions">
                <button type="button" class="action-btn classify-btn" data-paper-id="{{ paper.id }}">Classify <strong>this paper</strong></button>
                <button type="button" class="action-btn verify-btn" data-paper-id="{{ paper.id }}">Verify <strong>this paper</strong></button>
                <button type="button" class="action-btn save-btn" onclick="saveChanges('{{ paper.id }}')">Save Changes</button>
            </div>
            
        </form>
    </div>

    <div class="detail-content detail-trace detail-evaluator-trace">
        <strong>Evaluator Reasoning Trace:</strong>
        <div class="trace-content">{{ paper.reasoning_trace or 'No trace available.' }}</div> <!-- Load trace directly -->
    </div>
    <div class="detail-content detail-trace detail-verifier-trace">
        <strong>Verifier Reasoning Trace:</strong>
        <div class="trace-content">{{ paper.verifier_trace or 'No trace available.' }}</div> <!-- Load trace directly -->
    </div>
</div>
{% endblock %}
```

```html
# templates\index.html
<!-- templates/index.html -->
<!DOCTYPE html>
<html class="busyCursor">
<head>
    <title>ResearchParça - PCB Inspection Papers</title>
    <link rel="stylesheet" type="text/css" href="{{ url_for('static', filename='fonts.css') }}">
    <link rel="stylesheet" type="text/css" href="{{ url_for('static', filename='style.css') }}">

    <script src="{{ url_for('static', filename='chart.js') }}"></script>
    <script src="{{ url_for('static', filename='comms.js') }}" defer></script>
    <script src="{{ url_for('static', filename='filtering.js') }}" defer></script>
    <script src="{{ url_for('static', filename='stats.js') }}" defer></script>
    <!-- <script src="{{ url_for('static', filename='ghpages.js') }}" defer></script> -->
</head>
<body>
<input type="file" id="bibtex-file-input" accept=".bib" style="display: none;"> <!-- Hidden file input for BibTeX upload -->
<div class="table-container">
    <div id="papers-table-container">
        <table id="papersTable" style="table-layout: fixed;">
            <colgroup>
                <col style="width: 30px; min-width: 30px; max-width:30px;"> <!-- Column 1: Type (Rotated Header) -->
                <col style="width: 66%"> <!-- Column 2: Title (Should Expand)-->
                <col style="width: 40px; min-width: 40px; max-width:40px;"> <!-- Column 3: Year -->
                <col style="width: 34%"> <!-- Column 4: Journal/Conf (Should Expand) -->
                <col style="width: 30px; min-width: 30px; max-width:30px;"> <!-- Column 5: Pages (Rotated Header) -->
                <col style="width: 30px; min-width: 30px; max-width:30px;"> <!-- Off-topic -->
                <col style="width: 30px; min-width: 30px; max-width:30px;"> <!-- Relevance -->
                <col style="width: 30px; min-width: 30px; max-width:30px;"> <!-- Survey -->
                <col style="width: 30px; min-width: 30px; max-width:30px;"> <!-- THT -->
                <col style="width: 30px; min-width: 30px; max-width:30px;"> <!-- SMT -->
                <col style="width: 30px; min-width: 30px; max-width:30px;"> <!-- X-Ray -->

                <col style="width: 30px; min-width: 30px; max-width:30px;"> <!-- Tracks -->
                <col style="width: 30px; min-width: 30px; max-width:30px;"> <!-- Holes -->
                <col style="width: 30px; min-width: 30px; max-width:30px;"> <!-- Solder Insufficient -->
                <col style="width: 30px; min-width: 30px; max-width:30px;"> <!-- Solder Excess -->
                <col style="width: 30px; min-width: 30px; max-width:30px;"> <!-- Solder Void -->
                <col style="width: 30px; min-width: 30px; max-width:30px;"> <!-- Solder Crack -->
                <col style="width: 30px; min-width: 30px; max-width:30px;"> <!-- Missing Comp -->
                <col style="width: 30px; min-width: 30px; max-width:30px;"> <!-- Wrong Comp -->
                <col style="width: 30px; min-width: 30px; max-width:30px;"> <!-- Orientation -->
                <col style="width: 30px; min-width: 30px; max-width:30px;"> <!-- Cosmetic -->
                <col style="width: 30px; min-width: 30px; max-width:30px;"> <!-- Other -->

                <col style="width: 30px; min-width: 30px; max-width:30px;"> <!-- Classic CV -->
                <col style="width: 30px; min-width: 30px; max-width:30px;"> <!-- ML -->
                <col style="width: 30px; min-width: 30px; max-width:30px;"> <!-- CNN Classifier -->
                <col style="width: 30px; min-width: 30px; max-width:30px;"> <!-- CNN Detector -->
                <col style="width: 30px; min-width: 30px; max-width:30px;"> <!-- R-CNN Detector -->
                <col style="width: 30px; min-width: 30px; max-width:30px;"> <!-- Transformers -->
                <col style="width: 30px; min-width: 30px; max-width:30px;"> <!-- Other -->
                <col style="width: 30px; min-width: 30px; max-width:30px;"> <!-- Hybrid -->
                <col style="width: 30px; min-width: 30px; max-width:30px;"> <!-- Datasets  -->
                <!-- Columns 31-36: Other Data (Mixed Sizes) -->
                <col style="width: 56px; min-width: 56px; max-width: 56px;"> <!-- Last Changed -->
                <col style="width: 56px; min-width: 56px; max-width: 56px;"> <!-- Changed By -->
                <col style="width: 50px; min-width: 50px; max-width: 50px;"> <!-- Verified -->
                <col style="width: 32px; min-width: 32px; max-width: 32px;"> <!-- Accr. Score -->
                <col style="width: 50px; min-width: 50px; max-width: 50px;"> <!-- Verified By -->
                <col style="width: 30px; min-width: 30px; max-width: 30px;"> <!-- user comments state -->
                <col style="width: 44px; min-width: 44px; max-width: 44px;"> <!-- Details -->
            </colgroup>
            <thead>
                <tr>
                    <th id="main-header-wrapper" colspan=38>
                    <div class="main-header">
                        <div class="header-controls">
                            <button class="action-btn" id="import-bibtex-btn">Import <strong>BibTeX</strong></button>
                        </div>
                        <div class="header-controls">
                            <button class="action-btn" id="export-html-btn">Export <strong>HTML</strong></button>
                            <button class="action-btn" id="export-xlsx-btn">Export <strong>XLSX</strong></button>
                        </div>
                        <div class="header-branding"><span>Research</span><span style="font-weight: 600; color: var(--primary-ui-color);">Parça</span></div>
                        <div class="header-controls">
                            <button class="action-btn" id="stats-btn">View <strong>Statistics</strong></button>
                        </div>
                        <div class="header-controls">
                            <button class="action-btn" id="parça-tools-btn" style="background: linear-gradient(90deg, var(--classify-btn-color), var(--verify-btn-color));">
                                <div style="scale: 1.25; font-family: 'Arial Narrow'; font-weight: 400; text-shadow: var(--light-shadow);"><span style="font-weight: 600; opacity:0.9">Parça</span><span style=" opacity: 0.7">Tools</span></div>
                            </button>
                        </div>
                        <div class="header-controls">
                            <button class="action-btn" id="about-btn" title="About / Help" ><span>?</span></button>
                        </div>
                    </div>
                    </td>
                </tr>
                <tr>
                    <th class="ontop-header" colspan="5" rowspan="2"> 
                        <div class="header-filters">
                            <div class="filter-item">
                                <label for="min-page-count">Min. page count ≥</label>
                                <input type="number" id="min-page-count" value="{{ min_page_count_value }}" min="0" max="9">
                            </div>
                            <div class="filter-item">
                                <label for="year-from">Year:</label>
                                <input type="number" id="year-from" value="{{ year_from_value }}" min="2010" max="2026">
                                <label for="year-to">to</label>
                                <input type="number" id="year-to" value="{{ year_to_value }}" min="2010" max="2026">
                            </div>
                            <!-- This button will now trigger a page reload with updated URL parameters -->
                            <button class="action-btn" id="apply-serverside-filters" style="opacity:0; pointer-events: none;"><span>Apply</span></button>
                        </div>
                    </th>
                    <th class="inferred-header" id="inferred-header-title" colspan="26">
                        <div>
                            <span>Inferred data </span>
                            <input type="checkbox" title="Enable to only show misclassification suspects" id="hide-approved-checkbox">
                        </div><!--NLP--->
                    </th>
                    <th class="ontop-header" colspan="7" rowspan="2" >
                        <!-- <input type="search" id="search-input" placeholder="Type to search all fields..."> -->
                        <input type="search" id="search-input" placeholder="Type to search all fields..." value="{{ search_query_value }}">
                    </th>
                </tr>
                <tr>
                    <th class="inferred-header ontop-header" colspan="1">
                        <input type="checkbox" title="Enable to Hide Offtopic papers" id="hide-offtopic-checkbox" {% if hide_offtopic == true %}checked{% endif %}>
                    </th>
                    <th class="inferred-header ontop-header" colspan="1"></th>
                    <th class="inferred-header ontop-header" colspan="1">
                        <input type="checkbox" title="Enable to only show Surveys" id="only-survey-checkbox">
                    </th>
                    <th class="inferred-header ontop-header" colspan="2"></th>
                    <th class="inferred-header ontop-header" colspan="1">
                        <input type="checkbox" title="Enable to Hide X-Ray" id="hide-xray-checkbox" checked>    <!-- client-side, default enabled -->
                    </th>
                    <th class="inferred-header inferred-header-2 ontop-header" colspan="2">
                        <div>
                            <span>PCB</span>
                            <input type="checkbox" title="Enable to include papers about PCB features" id="show-pcb-checkbox">
                        </div>
                    </th>
                    <th class="inferred-header inferred-header-2 ontop-header" colspan="4">
                        <div>
                            <span>Solder</span>
                            <input type="checkbox" title="Enable to include papers about solder features" id="show-solder-checkbox">
                        </div>
                    </th>
                    <th class="inferred-header inferred-header-2 ontop-header" colspan="4">
                        <div>
                            <span>PCBA</span>
                            <input type="checkbox" title="Enable to include papers about PCBA features" id="show-pcba-checkbox">    
                        </div>
                    </th>
                    <th class="inferred-header inferred-header-2 ontop-header"></th>
                    <th class="inferred-header inferred-header-3 ontop-header" colspan="8">Techniques</th>
                    <!-- <th class="inferred-header inferred-header-3 ontop-header" colspan="6">DL-based</th> -->
                    <th class="inferred-header inferred-header-3 ontop-header" colspan="1"></th>
                </tr>
                <tr>
                    <th class="rotate-header status-header editable-header" data-sort="type"><div><span>Type</span></div> <span class="sort-indicator"></span></th>

                    <th data-sort="title">Title (Click for article) <span class="sort-indicator"></span></th>
                    <!-- <th data-sort="authors">Authors <span class="sort-indicator"></span></th> -->
                    <th data-sort="year">Year <span class="sort-indicator"></span></th>
                    <th data-sort="journal">Journal/Conf <span class="sort-indicator"></span></th>    
                    <th class="rotate-header" data-sort="page_count" ><div><span>Pages</span></div> <span class="sort-indicator"></span></th>


                    <!-- Classification Summary Columns -->
                    <th class="inferred-header rotate-header status-header editable-header" data-sort="is_offtopic"><span class="sort-indicator"></span><div><span>Off-topic</span></div></th>
                    <th class="inferred-header rotate-header status-header" data-sort="relevance"><span class="sort-indicator"></span><div><span>Relevance</span></div></th>
                    <th class="inferred-header rotate-header status-header editable-header" data-sort="is_survey"><span class="sort-indicator"></span><div><span>Survey</span></div></th>
                    <th class="inferred-header rotate-header status-header editable-header" data-sort="is_through_hole"><span class="sort-indicator"></span><div><span>THT</span></div></th>
                    <th class="inferred-header rotate-header status-header editable-header" data-sort="is_smt"><span class="sort-indicator"></span><div><span>SMT</span></div></th>
                    <th class="inferred-header rotate-header status-header editable-header" data-sort="is_x_ray"><span class="sort-indicator"></span><div><span>X-Ray</span></div></th>

                    <!-- Features Summary Columns (Updated list) -->
                    <th class="inferred-header inferred-header-2 rotate-header status-header editable-header" data-sort="features_tracks"><span class="sort-indicator"></span><div><span>Tracks</span></div></th>
                    <th class="inferred-header inferred-header-2 rotate-header status-header editable-header" data-sort="features_holes"><span class="sort-indicator"></span><div><span>Holes / Vias</span></div></th>

                    <th class="inferred-header inferred-header-2 rotate-header status-header editable-header" data-sort="features_solder_insufficient"><span class="sort-indicator"></span><div><span>Insufficient</span></div></th>
                    <th class="inferred-header inferred-header-2 rotate-header status-header editable-header" data-sort="features_solder_excess"><span class="sort-indicator"></span><div><span>Excessive</span></div></th>
                    <th class="inferred-header inferred-header-2 rotate-header status-header editable-header" data-sort="features_solder_void"><span class="sort-indicator"></span><div><span>Void / Hole</span></div></th>
                    <th class="inferred-header inferred-header-2 rotate-header status-header editable-header" data-sort="features_solder_crack"><span class="sort-indicator"></span><div><span>Crack / Cold</span></div></th>
                    
                    <th class="inferred-header inferred-header-2 rotate-header status-header editable-header" data-sort="features_missing_component"><span class="sort-indicator"></span><div><span>Missing Comp</span></div></th>
                    <th class="inferred-header inferred-header-2 rotate-header status-header editable-header" data-sort="features_wrong_component"><span class="sort-indicator"></span><div><span>Wrong Comp</span></div></th>
                    <th class="inferred-header inferred-header-2 rotate-header status-header editable-header" data-sort="features_orientation"><span class="sort-indicator"></span><div><span>Orientation</span></div></th>
                    <th class="inferred-header inferred-header-2 rotate-header status-header editable-header" data-sort="features_cosmetic"><span class="sort-indicator"></span><div><span>Cosmetic</span></div></th>
                    <th class="inferred-header inferred-header-2 rotate-header status-header editable-header" data-sort="features_other_state"><span class="sort-indicator"></span><div><span>Other</span></div></th>

                    <!-- Techniques Summary Columns (Updated list) -->
                    <th class="inferred-header inferred-header-3 rotate-header status-header editable-header" data-sort="technique_classic_cv_based"><span class="sort-indicator"></span><div><span>Classic CV</span></div></th>
                    <th class="inferred-header inferred-header-3 rotate-header status-header editable-header" data-sort="technique_ml_traditional"><span class="sort-indicator"></span><div><span>ML</span></div></th>
                    <th class="inferred-header inferred-header-3 rotate-header status-header editable-header" data-sort="technique_dl_cnn_classifier"><span class="sort-indicator"></span><div><span>CNN Classifier</span></div></th>
                    <th class="inferred-header inferred-header-3 rotate-header status-header editable-header" data-sort="technique_dl_cnn_detector"><span class="sort-indicator"></span><div><span>CNN Detector</span></div></th>
                    <th class="inferred-header inferred-header-3 rotate-header status-header editable-header" data-sort="technique_dl_rcnn_detector"><span class="sort-indicator"></span><div><span>R-CNN Detector</span></div></th>
                    <th class="inferred-header inferred-header-3 rotate-header status-header editable-header" data-sort="technique_dl_transformer"><span class="sort-indicator"></span><div><span>Transformer</span></div></th>
                    <th class="inferred-header inferred-header-3 rotate-header status-header editable-header" data-sort="technique_dl_other"><span class="sort-indicator"></span><div><span>Other DL</span></div></th>
                    <th class="inferred-header inferred-header-3 rotate-header status-header editable-header" data-sort="technique_hybrid"><span class="sort-indicator"></span><div><span>Hybrid</span></div></th>
                    <th class="inferred-header inferred-header-3 rotate-header status-header editable-header" data-sort="technique_available_dataset"><span class="sort-indicator"></span><div><span>Datasets</span></div></th>

                    <th data-sort="changed">Last Changed <span class="sort-indicator"></span></th>
                    <th data-sort="changed_by">Changed By <span class="sort-indicator"></span></th>
                    <th data-sort="verified">
                        <!--<input type="checkbox" title="Enable to only show misclassification suspects" id="hide-approved-checkbox">-->
                        Verified <span class="sort-indicator"></span>
                    </th>
                    <th class="rotate-header" data-sort="estimated_score"><div><span>Accr. Score</span></div> <span class="sort-indicator"></span></th>
                    <th data-sort="verified_by">Verified By <span class="sort-indicator"></span></th>
                    <th class="rotate-header status-header" data-sort="user_comment_state"><span class="sort-indicator"></span><div><span>Ccommented</span></div></th>
                    <th class="rotate-header"><div>Details</div></th> <!-- must be 50px due to 'collapse' button text -->
                </tr>
            </thead>
                <!-- tbody and tfoot come from the papers_table template-->
                {{ papers_table_content | safe }}        
                
                {% include 'papers_table_tfoot.html' %}
                <!-- Use the rendered table content passed from the server --> 
        </table>
    </div>

<div id="batchModal" class="modal">
<div id="batch-actions">
        <div style="scale: 1; font-family: 'Arial Narrow'; font-weight: 400; text-shadow: var(--light-shadow);font-size: 16pt;padding-bottom: 8px;"><span style="font-weight: 600; opacity:0.9">Parça</span><span style=" opacity: 0.7">Tools</span></div>
        
        <button class="action-btn" id="classify-remaining-btn">Classify <strong>Remaining</strong></button>
        <button class="action-btn" id="classify-all-btn">Re-Classify <strong>All</strong></button>
        <button class="action-btn" id="verify-remaining-btn">Verify <strong>Remaining</strong></button>
        <button class="action-btn" id="verify-all-btn">Re-Verify <strong>All</strong></button>
        <span id="batch-status-message" style="display:none"></span> <!-- obsolete, kept for JS -->
    </div>
</div>


<!-- Stats Modal -->
<div id="statsModal" class="modal">
    <div class="modal-content">
        <span class="close">&times;</span>
        <!-- <p> Data in <strong>all lists</strong> below is dynamically calculated based on <strong>currently visible</strong> papers:</p> -->
        <div class="stats-lists">
            <div class="stats-section">
                <h3>Repeating <strong>Journal/Conferences</strong><span style="font-size:0.6em"> — Scroll down on each list for more ↓</span></h3> </span></h3>  
                <ul id="journalStatsList"  class="stats-list-multicolumn-2"></ul>
            </div>
            <div class="stats-section">
                <h3>Repeating <strong>Keywords</strong> <span style="font-size:0.6em">↓</span></h3>
                <ul id="keywordStatsList" class="stats-list-multicolumn-short"></ul>        
            </div>
            <div class="stats-section">
                <h3>Repeating <strong>Authors</strong> <span style="font-size:0.6em">↓</span></h3>
                <ul id="authorStatsList" class="stats-list-multicolumn-short"></ul>
            </div>
            <div class="stats-section">
                <h3>Repeating <strong>Research Areas</strong> <span style="font-size:0.6em">↓</span></h3>
                <ul id="researchAreaStatsList" class="stats-list-multicolumn-short"></ul>
            </div>
            <div class="stats-section">
                <h3>Mentioned <strong>other detected features</strong> <span style="font-size:0.6em">↓</span></h3>
                <ul id="otherDetectedFeaturesStatsList" class="stats-list-multicolumn-2"></ul>
                <!-- show every non-blank instance of paper.features.other here. TBD. Can't be done client-side because detail row is lazy-loaded-->
            </div>
            <div class="stats-section">
                <h3>Mentioned <strong>Model Names</strong> <span style="font-size:0.6em">↓</span></h3>
                <ul id="modelNamesStatsList" class="stats-list-multicolumn-short"></ul>
                <!-- show every non-blank instance of paper.features.other here. TBD. Can't be done client-side because detail row is lazy-loaded-->
            </div>
        </div>
                
        <div class="stats-charts">
            <div class="stats-section">
                <h3><strong>Techniques</strong> Distribution</h3>
                <div class="chart-container" style="height:calc(100% - 43px); width:305px; max-width: 305px; margin: auto;">
                    <canvas id="techniquesPieChart"></canvas>
                </div>
            </div>
            <div class="stats-section">
                <h3><strong>Features</strong> Distribution</h3>
                <div class="chart-container" style="height:calc(100% - 43px); width:305px; max-width: 305px; margin: auto;">
                    <canvas id="featuresPieChart"></canvas>
                </div>
            </div>
            <div class="stats-section">                
                <h3><strong>Publication Types</strong> per Year</h3>
                <div class="chart-container-fullwidth" style="height: calc(80% - 20px); margin: auto;">
                    <canvas id="pubTypesPerYearLineChart"></canvas>
                </div>
            </div>
            <div class="stats-section">
                <h3><strong>Techniques</strong> per Year <span style="font-size:0.6em"> — Click on a label to show/hide its data and reflow the chart</span></h3>
                <div class="chart-container-fullwidth" style="height:calc(100% - 43px); margin: auto;">
                    <canvas id="techniquesPerYearLineChart"></canvas>
                </div>
            </div>

            <div class="stats-section">
                <h3><strong>Features</strong> per Year  <span style="font-size:0.6em"> — Data in this page is dynamically calculated based on <strong>currently visible</strong> papers.</span></h3>
                <div class="chart-container-fullwidth" style="height:calc(100% - 43px); margin: auto;">
                    <canvas id="featuresPerYearLineChart"></canvas>
                </div>
            </div>
            <div class="stats-section">
                <h3><strong>Survey</strong> vs <strong>Implementation</strong> Papers per Year</h3>
                <div class="chart-container-fullwidth" style="height:calc(80% - 20px);  margin: auto;">
                    <canvas id="surveyVsImplLineChart"></canvas>
                </div>
            </div>
        </div>
    </div>
</div>
<div id="aboutModal" class="modal">
    <div class="modal-small-content">
        <span class="close">&times;</span>
        <div class="modal-small-section">
            <h3><strong>Quick Help</strong> Guide</h3>
                <p style="margin-bottom: 0"><strong>Understanding the Symbols:</strong></p>
                <p style="margin: 0"><strong style="font-size:1.75em">✔️</strong>: Confirmed "Yes" (e.g., paper is a Survey, uses SMT, etc.);</p>
                <p style="margin: 0"><strong style="font-size:1.75em">❌</strong>: Confirmed "No";</p>
                <p style="margin: 0"><strong style="font-size:1.75em">❔</strong>: Unknown / Not Classified / Not Applicable;</p>
                <p style="margin: 0"><strong style="font-size:1.75em">👤</strong>: Last changed or verified by the (hopefully human) user;</p>
                <p style="margin: 0"><strong style="font-size:1.75em">🖥️</strong>: Last changed or verified by an AI Model (hover for model name);</p>

            <p><strong>How to Use:</strong></p>
                <p><strong>Filter Papers:</strong> Use the year range, minimum page count, and the search bar at the top. Press "Apply" (appears on change) for server-side filters.</p>
                <p><strong>Toggle Columns:</strong> Use checkboxes like "Hide Offtopic", "Hide X-Ray", or "Only Survey" for quick client-side filtering. As the checkboxes have no permanent labels, hover each checkbox to identify its purpose.</p>
                <p><strong>Classify/Verify:</strong> Click the "Classify this paper" or "Verify this paper" button in the detail row to run AI on a single paper. Use the top buttons for batch processing.</p>
                <p><strong>Edit Data:</strong> Click on any ✔️ / ❌ / ❔ symbol in the main table to cycle its value (this is automatically saved on change). Click 'show' in the details column to edit text fields (like "Model Name" or "Other Defects").
                    These have to be saved manually by clicking on "Save Changes". Editing functionality is unavailable on HTML exports.</p> 
                <p><strong>Search:</strong> Type on the search bar for instant search on all relevant fields. User comments are searchable. Classifier/Verifier traces are not (to avoid false-positives/noise)</p>
                <p><strong>View Statistics:</strong> Click the "View Statistics" button to see charts and lists of repeating journals, authors, keywords, and mentioned features/models as well as relevant charts. 
                    The stats are calculated based on currently visible filtered data.</p>
                <p><strong>Export Data:</strong> Use the "Export HTML" or "Export XLSX" buttons to download the currently filtered dataset.</p>
                <p><strong>Import Data:</strong> Use the "Import BibTeX" button to add new papers to the database from a .bib file. Import/Export functionality is unavailable on HTML exports.</p>

            <p><strong>Tip:</strong> The table is pre-sorted to show papers with user comments first. You can click any column header to sort by that field.</p>
        </div>
        <div class="modal-small-section" style="background: var(--detail-button-background);">
            <h3><strong>About</strong></h3>
                <div class="header-branding" style="padding: 10px 0 0;  text-align: center;"><span>Research</span><span style="font-weight: 600; color: var(--primary-ui-color);">Parça</span></div>
                <p><strong><a href="https://github.com/Zidrewndacht/bibtex-custom-parser" target="_blank" rel="noopener">ReseachParça</a> - PCB Inspection Papers Database Browser.</a></strong></p>
                <p>Developed by <a href="https://zidrewndacht.github.io/" target="_blank" rel="noopener"><strong>Luis Alfredo da Silva</strong></a>, 
                    to assist his own Master's degree research at <strong><a href="https://www.udesc.br/cct" target="_blank" rel="noopener">Universidade do Estado de Santa Catarina <strong>(UDESC)</strong></a></strong>. </p>
                <p>The following open source libraries, and its dependencies, are leveraged by this software:</p>
                <p><strong>Backend:</strong> 
                    <a href="https://www.python.org/" target="_blank" rel="noopener">Python</a>, 
                    <a href="https://flask.palletsprojects.com/" target="_blank" rel="noopener">Flask</a>, 
                    <a href="https://www.sqlite.org/" target="_blank" rel="noopener">SQLite3</a>
                </p>
                <p><strong>Frontend:</strong> 
                    <a href="https://developer.mozilla.org/en-US/docs/Web/Guide/HTML/HTML5" target="_blank" rel="noopener">HTML5</a>, 
                    <a href="https://developer.mozilla.org/en-US/docs/Web/CSS" target="_blank" rel="noopener">CSS3</a>, 
                    <a href="https://developer.mozilla.org/en-US/docs/Web/JavaScript" target="_blank" rel="noopener">JavaScript (Vanilla JS)</a>
                </p>
                <p><strong>Data Visualization:</strong> 
                    <a href="https://www.chartjs.org/" target="_blank" rel="noopener">Chart.js</a>
                </p>
                <p><strong>Utilities:</strong> 
                    <a href="https://opensource.perlig.de/rcssmin/" target="_blank" rel="noopener">rcssmin</a>, 
                    <a href="https://opensource.perlig.de/rjsmin/" target="_blank" rel="noopener">rjsmin</a> (minification), 
                    <a href="https://openpyxl.readthedocs.io/" target="_blank" rel="noopener">openpyxl</a> (Excel export), 
                    <a href="https://nodeca.github.io/pako/" target="_blank" rel="noopener">pako</a> (compressed HTML export)
                </p>
                <p>Classification and verification was inferenced by Unsloth's Dynamic quants of <strong><a href="https://huggingface.co/unsloth/Qwen3-30B-A3B-Thinking-2507-GGUF" target="_blank" rel="noopener">Qwen3-30B-A3B-Thinking-2507</a></strong> model from <strong><a href="https://www.alibabacloud.com/en/solutions/generative-ai/qwen?_p_lc=1" target="_blank" rel="noopener">Qwen/Alibaba Cloud</a>.</strong></p>
                <p><strong>Local Inference engine:</strong> <a href="https://github.com/ggerganov/llama.cpp" target="_blank" rel="noopener">llama.cpp</a>.</p>
                <p>Original papers data (BibTeX) was sourced from 
                    <a href="https://www.scopus.com/" target="_blank" rel="noopener">Scopus</a>, 
                    <a href="https://ieeexplore.ieee.org/" target="_blank" rel="noopener">IEEE Xplore</a> (some) and 
                    <a href="https://dl.acm.org/" target="_blank" rel="noopener">ACM Digital Library</a>
                </p>
                <p><strong>Original search query:</strong>
                    <span style="font-size:0.75em">("printed circuit*" OR "Circuit board*" OR pcb OR pcba) AND (inspection OR manufactur* OR assembly OR defect* OR solder* OR weld* OR "Automat* optical")</span>
                </p>
            </div>
        </div>
    </div>
</div>
</body>
</html>
```

```html
# templates\index_static_export.html
<!DOCTYPE html>
<html class="busyCursor">
<head>
    <title>ResearchParça - PCB Inspection Papers</title>
    <link rel="stylesheet" type="text/css" href="static/fonts.css">
    <style>
    {{ style_css_content | safe }}
    /* Overrides for static export: Disable editable status hover/active, doing it here because .editable-status is used by JS for sorting, etc.*/        
    .editable-status:active,.editable-status:hover,.editable-verify:active,.editable-verify:hover{transform:unset;background-color:unset;cursor:default}
    .editable-status:hover,.editable-verify:hover{box-shadow:0 1px 2px rgba(0,0,0,.1)}
    /* fix ? / stats buttons misalingment cross-browser gaslighting: */
    .header-filters > div:last-child { 
        display: flex;
        align-items: center; /* Align items vertically in the center */
        gap: 4px; /* Control spacing between items */
    }
    </style>
    <script>
    {{ chart_js_content | safe }}
    </script>
</head>
<body>
<div class="table-container">
        <table id="papersTable" style="table-layout: fixed;">
            <colgroup>
                <col style="width: 30px; min-width: 30px; max-width:30px;"> 
                <col style="width: 66%"> 
                <col style="width: 40px; min-width: 40px; max-width:40px;"> 
                <col style="width: 34%"> 
                <col style="width: 30px; min-width: 30px; max-width:30px;"> 
                <col style="width: 30px; min-width: 30px; max-width:30px;"> 
                <col style="width: 30px; min-width: 30px; max-width:30px;"> 
                <col style="width: 30px; min-width: 30px; max-width:30px;"> 
                <col style="width: 30px; min-width: 30px; max-width:30px;"> 
                <col style="width: 30px; min-width: 30px; max-width:30px;"> 
                <col style="width: 30px; min-width: 30px; max-width:30px;"> 

                <col style="width: 30px; min-width: 30px; max-width:30px;"> 
                <col style="width: 30px; min-width: 30px; max-width:30px;"> 
                <col style="width: 30px; min-width: 30px; max-width:30px;"> 
                <col style="width: 30px; min-width: 30px; max-width:30px;"> 
                <col style="width: 30px; min-width: 30px; max-width:30px;"> 
                <col style="width: 30px; min-width: 30px; max-width:30px;"> 
                <col style="width: 30px; min-width: 30px; max-width:30px;"> 
                <col style="width: 30px; min-width: 30px; max-width:30px;"> 
                <col style="width: 30px; min-width: 30px; max-width:30px;"> 
                <col style="width: 30px; min-width: 30px; max-width:30px;"> 
                <col style="width: 30px; min-width: 30px; max-width:30px;"> 

                <col style="width: 30px; min-width: 30px; max-width:30px;"> 
                <col style="width: 30px; min-width: 30px; max-width:30px;"> 
                <col style="width: 30px; min-width: 30px; max-width:30px;"> 
                <col style="width: 30px; min-width: 30px; max-width:30px;"> 
                <col style="width: 30px; min-width: 30px; max-width:30px;"> 
                <col style="width: 30px; min-width: 30px; max-width:30px;"> 
                <col style="width: 30px; min-width: 30px; max-width:30px;"> 
                <col style="width: 30px; min-width: 30px; max-width:30px;"> 
                <col style="width: 30px; min-width: 30px; max-width:30px;"> 
                
                <col style="width: 56px; min-width: 56px; max-width: 56px;"> 
                <col style="width: 56px; min-width: 56px; max-width: 56px;"> 
                <col style="width: 50px; min-width: 50px; max-width: 50px;"> 
                <col style="width: 32px; min-width: 32px; max-width: 32px;"> 
                <col style="width: 50px; min-width: 50px; max-width: 50px;"> 
                <col style="width: 30px; min-width: 30px; max-width: 30px;"> 
                <col style="width: 44px; min-width: 44px; max-width: 44px;"> 
            </colgroup>
            <thead>
                <tr>
                    <th id="main-header-wrapper" colspan=38 style="display: none;"></th> <!-- this must exist for CSS consistency between export and real page (uses nth-child, etc.) -->
                </tr>
                <tr>
                    <th class="ontop-header" colspan="5" rowspan="2"> 
                        <div class="header-filters">
                            <div class="filter-item">
                                <input type="checkbox" id="hide-short-checkbox"  style="display: none;">
                                <label for="min-page-count">Min. page count ≥</label>
                                <input type="number" id="min-page-count" value="{{ min_page_count_value }}" min="{{ min_page_count_value }}" max="9" title="Exported file contains papers with at least {{ min_page_count_value }} pages">
                            </div>
                            <div class="filter-item">
                                <label for="year-from">Year:</label>
                                <input type="number" id="year-from" value="{{ year_from_value }}" min="{{ year_from_value }}" max="{{ year_to_value }}" title="Exported file contains papers from {{ year_from_value }} to {{ year_to_value }}.">
                                <label for="year-to">to</label>
                                <input type="number" id="year-to" value="{{ year_to_value }}" min="{{ year_from_value }}" max="{{ year_to_value }}" title="Exported file contains papers from {{ year_from_value }} to {{ year_to_value }}.">
                            </div>
                            <div>
                                <button class="action-btn" id="static-about-btn" title="About / Help" ><span>?</span></button>
                                <button class="action-btn" id="static-stats-btn">View <strong>Statistics</strong></button>
                            </div>
                        </div>
                    </th>
                    <th class="inferred-header" id="inferred-header-title" colspan="26">
                        <div>
                            <span>Inferred data</span>
                            <div style="font-size: 7pt; font-family: 'Arial Narrow'; text-shadow: var(--light-shadow); transform:scale(2.2) translateY(-1px);">
                                <span style="font-weight: 400; opacity: 0.7;">Research</span><span style="font-weight: 600; opacity: 0.85;">Parça</span>
                            </div>                            
                            <input type="checkbox" title="Enable to only show misclassification suspects" id="hide-approved-checkbox">
                        </div>
                    </th>
                    
                    <th class="ontop-header" colspan="7" rowspan="2" >
                        
                        <input type="search" id="search-input" placeholder="Type to search all fields..." value="{{ search_query_value }}">
                    </th>
                </tr>
                <tr>
                    <th class="inferred-header ontop-header" colspan="1"><input type="checkbox" id="hide-offtopic-checkbox" {% if hide_offtopic == true %}checked disabled title="Can't unhide offtopic papers. File was exported only with ontopic papers"{% endif %}></th>
                    <th class="inferred-header ontop-header" colspan="1"></th>
                    <th class="inferred-header ontop-header" colspan="1">
                        <input type="checkbox" title="Enable to only show Surveys" id="only-survey-checkbox">
                    </th>
                    <th class="inferred-header ontop-header" colspan="2"></th>
                    <th class="inferred-header ontop-header" colspan="1">
                        <input type="checkbox" title="Enable to Hide X-Ray" id="hide-xray-checkbox" checked>    <!-- client-side, default enabled -->
                    </th>
                    <th class="inferred-header inferred-header-2 ontop-header" colspan="2">
                        <div>
                            <span>PCB</span>
                            <input type="checkbox" title="Enable to include papers about PCB features" id="show-pcb-checkbox">   
                        </div>
                    </th>
                    <th class="inferred-header inferred-header-2 ontop-header" colspan="4">
                        <div>
                            <span>Solder</span>
                            <input type="checkbox" title="Enable to include papers about solder features" id="show-solder-checkbox">
                        </div>
                    </th>
                    <th class="inferred-header inferred-header-2 ontop-header" colspan="5">
                        <div>
                            <span>PCBA</span>
                            <input type="checkbox" title="Enable to include papers about PCBA features" id="show-pcba-checkbox">    
                        </div>
                    </th>
                    <th class="inferred-header inferred-header-3 ontop-header" colspan="8">Techniques</th>
                    <!-- <th class="inferred-header inferred-header-3 ontop-header" colspan="6">DL-based</th> -->
                    <th class="inferred-header inferred-header-3 ontop-header" colspan="1"></th>
                </tr>
                <tr>
                    <th class="rotate-header status-header editable-header" data-sort="type"><div><span>Type</span></div> <span class="sort-indicator"></span></th>

                    <th data-sort="title">Title (Click for article) <span class="sort-indicator"></span></th>
                    
                    <th data-sort="year">Year <span class="sort-indicator"></span></th>
                    <th data-sort="journal">Journal/Conf <span class="sort-indicator"></span></th>    
                    <th class="rotate-header" data-sort="page_count" ><div><span>Pages</span></div> <span class="sort-indicator"></span></th>

                    
                    <th class="inferred-header rotate-header status-header editable-header" data-sort="is_offtopic"><span class="sort-indicator"></span><div><span>Off-topic</span></div></th>
                    <th class="inferred-header rotate-header status-header" data-sort="relevance"><span class="sort-indicator"></span><div><span>Relevance</span></div></th>
                    <th class="inferred-header rotate-header status-header editable-header" data-sort="is_survey"><span class="sort-indicator"></span><div><span>Survey</span></div></th>
                    <th class="inferred-header rotate-header status-header editable-header" data-sort="is_through_hole"><span class="sort-indicator"></span><div><span>THT</span></div></th>
                    <th class="inferred-header rotate-header status-header editable-header" data-sort="is_smt"><span class="sort-indicator"></span><div><span>SMT</span></div></th>
                    <th class="inferred-header rotate-header status-header editable-header" data-sort="is_x_ray"><span class="sort-indicator"></span><div><span>X-Ray</span></div></th>

                    
                    <th class="inferred-header inferred-header-2 rotate-header status-header editable-header" data-sort="features_tracks"><span class="sort-indicator"></span><div><span>Tracks</span></div></th>
                    <th class="inferred-header inferred-header-2 rotate-header status-header editable-header" data-sort="features_holes"><span class="sort-indicator"></span><div><span>Holes / Vias</span></div></th>

                    <th class="inferred-header inferred-header-2 rotate-header status-header editable-header" data-sort="features_solder_insufficient"><span class="sort-indicator"></span><div><span>Insufficient</span></div></th>
                    <th class="inferred-header inferred-header-2 rotate-header status-header editable-header" data-sort="features_solder_excess"><span class="sort-indicator"></span><div><span>Excessive</span></div></th>
                    <th class="inferred-header inferred-header-2 rotate-header status-header editable-header" data-sort="features_solder_void"><span class="sort-indicator"></span><div><span>Void / Hole</span></div></th>
                    <th class="inferred-header inferred-header-2 rotate-header status-header editable-header" data-sort="features_solder_crack"><span class="sort-indicator"></span><div><span>Crack / Cold</span></div></th>
                    
                    <th class="inferred-header inferred-header-2 rotate-header status-header editable-header" data-sort="features_missing_component"><span class="sort-indicator"></span><div><span>Missing Comp</span></div></th>
                    <th class="inferred-header inferred-header-2 rotate-header status-header editable-header" data-sort="features_wrong_component"><span class="sort-indicator"></span><div><span>Wrong Comp</span></div></th>
                    <th class="inferred-header inferred-header-2 rotate-header status-header editable-header" data-sort="features_orientation"><span class="sort-indicator"></span><div><span>Orientation</span></div></th>
                    <th class="inferred-header inferred-header-2 rotate-header status-header editable-header" data-sort="features_cosmetic"><span class="sort-indicator"></span><div><span>Cosmetic</span></div></th>
                    <th class="inferred-header inferred-header-2 rotate-header status-header editable-header" data-sort="features_other_state"><span class="sort-indicator"></span><div><span>Other</span></div></th>

                    
                    <th class="inferred-header inferred-header-3 rotate-header status-header editable-header" data-sort="technique_classic_cv_based"><span class="sort-indicator"></span><div><span>Classic CV</span></div></th>
                    <th class="inferred-header inferred-header-3 rotate-header status-header editable-header" data-sort="technique_ml_traditional"><span class="sort-indicator"></span><div><span>ML</span></div></th>
                    <th class="inferred-header inferred-header-3 rotate-header status-header editable-header" data-sort="technique_dl_cnn_classifier"><span class="sort-indicator"></span><div><span>CNN Classifier</span></div></th>
                    <th class="inferred-header inferred-header-3 rotate-header status-header editable-header" data-sort="technique_dl_cnn_detector"><span class="sort-indicator"></span><div><span>CNN Detector</span></div></th>
                    <th class="inferred-header inferred-header-3 rotate-header status-header editable-header" data-sort="technique_dl_rcnn_detector"><span class="sort-indicator"></span><div><span>R-CNN Detector</span></div></th>
                    <th class="inferred-header inferred-header-3 rotate-header status-header editable-header" data-sort="technique_dl_transformer"><span class="sort-indicator"></span><div><span>Transformer</span></div></th>
                    <th class="inferred-header inferred-header-3 rotate-header status-header editable-header" data-sort="technique_dl_other"><span class="sort-indicator"></span><div><span>Other DL</span></div></th>
                    <th class="inferred-header inferred-header-3 rotate-header status-header editable-header" data-sort="technique_hybrid"><span class="sort-indicator"></span><div><span>Hybrid</span></div></th>
                    <th class="inferred-header inferred-header-3 rotate-header status-header editable-header" data-sort="technique_available_dataset"><span class="sort-indicator"></span><div><span>Datasets</span></div></th>

                    <th data-sort="changed">Last Changed <span class="sort-indicator"></span></th>
                    <th data-sort="changed_by">Changed By <span class="sort-indicator"></span></th>
                    <th data-sort="verified">Verified <span class="sort-indicator"></span></th>
                    <th class="rotate-header" data-sort="estimated_score"><div><span>Accr. Score</span></div> <span class="sort-indicator"></span></th>
                    <th data-sort="verified_by">Verified By <span class="sort-indicator"></span></th>
                    <th class="rotate-header status-header" data-sort="user_comment_state"><span class="sort-indicator"></span><div><span>Commented</span></div></th>
                    <th class="rotate-header"><div>Details</div></th> 
                </tr>
        </thead>
        {{ papers_table_static_export | safe }}
        {% include 'papers_table_tfoot.html' %}
    </table>
</div>

<div id="statsModal" class="modal">
    <div class="modal-content">
        <span class="close">&times;</span>
        <div class="stats-lists">
            <div class="stats-section">
                <h3>Repeating <strong>Journal/Conferences</strong><span style="font-size:0.6em"> — Scroll down on each list for more ↓</span></h3> </span></h3>  
                <ul id="journalStatsList"  class="stats-list-multicolumn-2"></ul>
            </div>
            <div class="stats-section">
                <h3>Repeating <strong>Keywords</strong></h3> 
                <ul id="keywordStatsList" class="stats-list-multicolumn-short"></ul>        
            </div>
            <div class="stats-section">
                <h3>Repeating <strong>Authors</strong></h3> 
                <ul id="authorStatsList" class="stats-list-multicolumn-short"></ul>
            </div>
            <div class="stats-section">
                <h3>Repeating <strong>Research Areas</strong></h3> 
                <ul id="researchAreaStatsList" class="stats-list-multicolumn-short"></ul>
            </div>
            <div class="stats-section">
                <h3>Mentioned <strong>other detected features</strong></h3> 
                <ul id="otherDetectedFeaturesStatsList" class="stats-list-multicolumn-2"></ul>
            </div>
            <div class="stats-section">
                <h3>Mentioned <strong>Model Names</strong></h3> 
                <ul id="modelNamesStatsList" class="stats-list-multicolumn-short"></ul>
            </div>
        </div>
        <div class="stats-charts">
            <div class="stats-section">
                <h3><strong>Techniques</strong> Distribution</h3>
                <div class="chart-container" style="height:calc(100% - 43px); width:305px; max-width: 305px; margin: auto;">
                    <canvas id="techniquesPieChart"></canvas>
                </div>
            </div>
            <div class="stats-section">
                <h3><strong>Features</strong> Distribution</h3>
                <div class="chart-container" style="height:calc(100% - 43px); width:305px; max-width: 305px; margin: auto;">
                    <canvas id="featuresPieChart"></canvas>
                </div>
            </div>
            <div class="stats-section">                
                <h3><strong>Publication Types</strong> per Year</h3>
                <div class="chart-container-fullwidth" style="height: calc(80% - 20px); margin: auto;">
                    <canvas id="pubTypesPerYearLineChart"></canvas>
                </div>
            </div>
            <div class="stats-section">
                <h3><strong>Techniques</strong> per Year <span style="font-size:0.6em"> — Click on a label to show/hide its data and reflow the chart</span></h3>
                <div class="chart-container-fullwidth" style="height:calc(100% - 43px); margin: auto;">
                    <canvas id="techniquesPerYearLineChart"></canvas>
                </div>
            </div>

            <div class="stats-section">
                <h3><strong>Features</strong> per Year  <span style="font-size:0.6em"> — Data in this page is dynamically calculated based on <strong>currently visible</strong> papers.</span></h3>
                <div class="chart-container-fullwidth" style="height:calc(100% - 43px); margin: auto;">
                    <canvas id="featuresPerYearLineChart"></canvas>
                </div>
            </div>
            <div class="stats-section">
                <h3><strong>Survey</strong> vs <strong>Implementation</strong> Papers per Year</h3>
                <div class="chart-container-fullwidth" style="height:calc(80% - 20px);  margin: auto;">
                    <canvas id="surveyVsImplLineChart"></canvas>
                </div>
            </div>
        </div>
    </div>
</div>

<div id="aboutModal" class="modal">
    <div class="modal-small-content">
        <span class="close">&times;</span>
        <div class="modal-small-section">
            <h3><strong>Quick Help</strong> Guide</h3>
            <p style="margin-bottom: 0"><strong>Understanding the Symbols:</strong></p>
                <p style="margin: 0"><strong style="font-size:1.75em">✔️</strong>: Confirmed "Yes" (e.g., paper is a Survey, uses SMT, etc.);</p>
                <p style="margin: 0"><strong style="font-size:1.75em">❌</strong>: Confirmed "No";</p>
                <p style="margin: 0"><strong style="font-size:1.75em">❔</strong>: Unknown / Not Classified / Not Applicable;</p>
                <p style="margin: 0"><strong style="font-size:1.75em">👤</strong>: Last changed or verified by the (hopefully human) user;</p>
                <p style="margin: 0"><strong style="font-size:1.75em">🖥️</strong>: Last changed or verified by an AI Model (hover for model name);</p>

            <p><strong>How to Use:</strong></p>
                <p><strong>Filter Papers:</strong> Use the year range, minimum page count, and the search bar at the top. Press "Apply" (appears on change) for server-side filters.</p>
                <p><strong>Toggle Columns:</strong> Use checkboxes like "Hide Offtopic", "Hide X-Ray", or "Only Survey" for quick client-side filtering. As the checkboxes have no permanent labels, hover each checkbox to identify its purpose.</p>
                <p><strong>Classify/Verify:</strong> Click the "Classify this paper" or "Verify this paper" button in the detail row to run AI on a single paper. Use the top buttons for batch processing.</p>
                <p><strong>Search:</strong> Type on the search bar for instant search on all relevant fields. User comments are searchable. Classifier/Verifier traces are not (to avoid false-positives/noise)</p>
                <p><strong>View Statistics:</strong> Click the "View Statistics" button to see charts and lists of repeating journals, authors, keywords, and mentioned features/models as well as relevant charts. 
                    The stats are calculated based on currently visible filtered data.</p>
                <p><strong>Import/Export and Edit Data:</strong> These functionalities are unavailable on HTML exports. Use the full Flask application instead.</p> 


            <p><strong>Tip:</strong> The table is pre-sorted to show papers with user comments first. You can click any column header to sort by that field.</p>
        </div>
        <div class="modal-small-section" style="background: var(--detail-button-background);">
            <h3><strong>About</strong></h3>
                <div class="header-branding" style="padding: 10px 0 0;  text-align: center;"><span>Research</span><span style="font-weight: 600; color: var(--primary-ui-color);">Parça</span></div>
                <p><strong><a href="https://github.com/Zidrewndacht/bibtex-custom-parser" target="_blank" rel="noopener">ReseachParça</a> - PCB Inspection Papers Database Browser.</a></strong></p>
                <p>Developed by <a href="https://zidrewndacht.github.io/" target="_blank" rel="noopener"><strong>Luis Alfredo da Silva</strong></a>, 
                    to assist his own Master's degree research at <strong><a href="https://www.udesc.br/cct" target="_blank" rel="noopener">Universidade do Estado de Santa Catarina <strong>(UDESC)</strong></a></strong>. </p>
                <p>The following open source libraries, and its dependencies, are leveraged by this software:</p>
                <p><strong>Backend:</strong> 
                    <a href="https://www.python.org/" target="_blank" rel="noopener">Python</a>, 
                    <a href="https://flask.palletsprojects.com/" target="_blank" rel="noopener">Flask</a>, 
                    <a href="https://www.sqlite.org/" target="_blank" rel="noopener">SQLite3</a>
                </p>
                <p><strong>Frontend:</strong> 
                    <a href="https://developer.mozilla.org/en-US/docs/Web/Guide/HTML/HTML5" target="_blank" rel="noopener">HTML5</a>, 
                    <a href="https://developer.mozilla.org/en-US/docs/Web/CSS" target="_blank" rel="noopener">CSS3</a>, 
                    <a href="https://developer.mozilla.org/en-US/docs/Web/JavaScript" target="_blank" rel="noopener">JavaScript (Vanilla JS)</a>, <a href="https://www.chartjs.org/" target="_blank" rel="noopener">Chart.js</a>
                </p>
                <p><strong>Utilities:</strong> 
                    <a href="https://opensource.perlig.de/rcssmin/" target="_blank" rel="noopener">rcssmin</a>, 
                    <a href="https://opensource.perlig.de/rjsmin/" target="_blank" rel="noopener">rjsmin</a> (minification), 
                    <a href="https://openpyxl.readthedocs.io/" target="_blank" rel="noopener">openpyxl</a> (Excel export), 
                    <a href="https://nodeca.github.io/pako/" target="_blank" rel="noopener">pako</a> (compressed HTML export)
                </p>
                <p>Classification and verification was inferenced by Unsloth's Dynamic quants of <strong><a href="https://huggingface.co/unsloth/Qwen3-30B-A3B-Thinking-2507-GGUF" target="_blank" rel="noopener">Qwen3-30B-A3B-Thinking-2507</a></strong> model from <strong><a href="https://www.alibabacloud.com/en/solutions/generative-ai/qwen?_p_lc=1" target="_blank" rel="noopener">Qwen/Alibaba Cloud</a>.</strong></p>
                <p><strong>Local Inference engine:</strong> <a href="https://github.com/ggerganov/llama.cpp" target="_blank" rel="noopener">llama.cpp</a>.</p>
                <p>Original papers data (BibTeX) was sourced from 
                    <a href="https://www.scopus.com/" target="_blank" rel="noopener">Scopus</a>, 
                    <a href="https://ieeexplore.ieee.org/" target="_blank" rel="noopener">IEEE Xplore</a> (some) and 
                    <a href="https://dl.acm.org/" target="_blank" rel="noopener">ACM Digital Library</a>
                </p>
                <p><strong>Original search query:</strong>
                    <span style="font-size:0.75em">("printed circuit*" OR "Circuit board*" OR pcb OR pcba) AND (inspection OR manufactur* OR assembly OR defect* OR solder* OR weld* OR "Automat* optical")</span>
                </p>
            </div>
        </div>
    </div>
</div>
<script>
    {{ ghpages_js_content | safe }}
</script>
</body>
</html>
```

```html
# templates\loader.html
<!DOCTYPE html>
<html>
<head>
    <title>Loading ResearchParça...</title>
    <style>
        /* Minimal styling for the loading indicator */
        body { font-family: sans-serif; display: flex; flex-direction: column; gap: 40px; justify-content: center; align-items: center; height: 100vh; margin: 0; background-color: #f5f5f5; }
        .loading, #previewMessage { text-align: center; }
        /* .spinner { border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; width: 30px; height: 30px; animation: spin 1s linear infinite; margin: 0 auto 10px; } */
                
        .spinner {
            width: 60px;
            height: 60px;
            border: 12px solid hsl(188, 36%, 30%);
            border-top: 12px solid transparent;
            border-radius: 50%;
            animation: spin 0.75s linear infinite;
            margin: 0 auto 30px; 
        }
        .header-branding{
            font-size: 48pt;
            justify-self: center;
            font-family: "Arial Narrow";
            font-weight: 400;
            color: #3f8d82;
            text-shadow: 1px 0 5px #fff6;
        }


        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
    <!-- Inline the Pako library for Gzip decompression -->
    <script>
    {{ pako_js_content | safe }} 
    </script>
</head>
<body>
    <div class="header-branding"><span>Research</span><span style="font-weight: 600; color: hsl(188, 31%, 29%);">Parça</span></div>
    <div class="loading" id="splash-spinner">
        <div class="spinner"></div>
        <p>Trying to decompress and load page...</p>
        <p>This file requires JavaScript to decompress and load its content.</br>
        Download and open it in a full web browser to view.</p>
    </div>

    <script>
        const compressedDataBase64 = "{{ compressed_html_data | safe }}";         // The compressed HTML data passed from Flask

        function loadContent() {
            try {
                const compressedBytes = Uint8Array.from(atob(compressedDataBase64), c => c.charCodeAt(0));  // 1. Decode Base64 to get compressed bytes (as Uint8Array)
                const decompressedBytes = pako.inflate(compressedBytes);                                    // 2. Decompress using Pako (inflate)                
                const decompressedHtmlString = new TextDecoder("utf-8").decode(decompressedBytes);          // 3. Decode bytes back to string (assuming UTF-8)

                // 4. Write the full HTML content to the document, replacing this loader
                // Using document.write after the page loads replaces the entire document
                document.open();
                document.write(decompressedHtmlString);
                document.close();

            } catch (error) {
                console.error("Failed to decompress or load content:", error);
                document.body.innerHTML = "<p style='color:red;'>Error loading data. Please check the console for details.</p>";
            }
        }

        // Start loading when the window loads
        window.addEventListener('load', loadContent);
    </script>
</body>
</html>
```

```html
# templates\papers_table.html
<!-- templates/papers_table.html -->
{% block papers_table_content %}
<tbody style="position: relative;">
<tr>
    <td style="padding:0;">
        <div class="loading-overlay">
            <div class="header-branding"><span>Research</span><span style="font-weight: 600; color: var(--primary-ui-color);">Parça</span></div>
            <div class="loading-spinner"></div>
            <div>Reprocessing table. Wait patiently. </div>
        </div>
    </td>
</tr>
{% for paper in papers %}
    <tr data-paper-id="{{ paper.id }}" >
        <!-- Use the emoji mapping passed from Python -->
        <td class="status-cell" title="{{ paper.type }}">{{ type_emojis.get(paper.type, default_type_emoji) }} 
        </td><td class="title-cell">
            {% if paper.doi %}
                <a href="https://doi.org/{{ paper.doi }}" target="_blank">{{ paper.title }}</a>
            {% else %}
                <span style="font-weight: 300;">{{paper.title}}</span> 
            {% endif %}
            
        </td>
        <td class="secondary-text-cell number-cell" style="width:28px; min-width:28px; max-width:28px">{{ paper.year or '' }}</td>
        <td class="secondary-text-cell">{{ paper.journal }}</td>        
        <td class="secondary-text-cell number-cell">{{ paper.page_count or '' }}</td>

        <td class="status-cell editable-status" data-field="is_offtopic">{{ paper.is_offtopic | render_status }}</td>
        <td class="secondary-text-cell number-cell">{{ paper.relevance or '' }}</td>        <!-- NEW DATA CELL: Relevance -->
        <td class="status-cell editable-status" data-field="is_survey">{{ paper.is_survey | render_status }}</td>
        <td class="status-cell editable-status" data-field="is_through_hole">{{ paper.is_through_hole | render_status }}</td>
        <td class="status-cell editable-status" data-field="is_smt">{{ paper.is_smt | render_status }}</td>
        <td class="status-cell editable-status" data-field="is_x_ray">{{ paper.is_x_ray | render_status }}</td>

        <td class="status-cell editable-status highlight-status" data-field="features_tracks">{{ paper.features.tracks | render_status }}</td>
        <td class="status-cell editable-status highlight-status" data-field="features_holes">{{ paper.features.holes | render_status }}</td>
        <td class="status-cell editable-status"  data-field="features_solder_insufficient">{{ paper.features.solder_insufficient | render_status }}</td>
        <td class="status-cell editable-status"  data-field="features_solder_excess">{{ paper.features.solder_excess | render_status }}</td>
        <td class="status-cell editable-status"  data-field="features_solder_void">{{ paper.features.solder_void | render_status }}</td>
        <td class="status-cell editable-status"  data-field="features_solder_crack">{{ paper.features.solder_crack | render_status }}</td>
        <td class="status-cell editable-status highlight-status" data-field="features_missing_component">{{ paper.features.missing_component | render_status }}</td>
        <td class="status-cell editable-status highlight-status" data-field="features_wrong_component">{{ paper.features.wrong_component | render_status }}</td>
        <td class="status-cell editable-status highlight-status" data-field="features_orientation">{{ paper.features.orientation | render_status }}</td>
        <td class="status-cell editable-status highlight-status" data-field="features_cosmetic">{{ paper.features.cosmetic | render_status }}</td>
        <td class="status-cell highlight-status" data-field="features_other_state">{{ '✔️' if paper.features.other and (paper.features.other|string).strip() else '❌' }}</td>

        <td class="status-cell editable-status" data-field="technique_classic_cv_based">{{ paper.technique.classic_cv_based | render_status }}</td>
        <td class="status-cell editable-status" data-field="technique_ml_traditional">{{ paper.technique.ml_traditional | render_status }}</td>
        <td class="status-cell editable-status" data-field="technique_dl_cnn_classifier">{{ paper.technique.dl_cnn_classifier | render_status }}</td>
        <td class="status-cell editable-status" data-field="technique_dl_cnn_detector">{{ paper.technique.dl_cnn_detector | render_status }}</td>
        <td class="status-cell editable-status" data-field="technique_dl_rcnn_detector">{{ paper.technique.dl_rcnn_detector | render_status }}</td>
        <td class="status-cell editable-status" data-field="technique_dl_transformer">{{ paper.technique.dl_transformer | render_status }}</td>
        <td class="status-cell editable-status" data-field="technique_dl_other">{{ paper.technique.dl_other | render_status }}</td>
        <td class="status-cell editable-status" data-field="technique_hybrid">{{ paper.technique.hybrid | render_status }}</td>
        <td class="status-cell editable-status highlight-status" data-field="technique_available_dataset">{{ paper.technique.available_dataset | render_status }}</td>

        <td class="secondary-text-cell changed-cell highlight-status">{{ paper.changed_formatted }}</td> <!-- Use formatted timestamp -->
        <td class="status-cell changed-by-cell highlight-status" data-field="changed_by">{{ paper.changed_by | render_changed_by }}</td>           
        <td class="status-cell editable-status" data-field="verified">{{ paper.verified | render_status }}</td>
        <td class="secondary-text-cell number-cell" data-field="verified">{{ paper.estimated_score  or '' }}</td>
        <td class="status-cell editable-verify" data-field="verified_by">{{ paper.verified_by | render_verified_by }}</td>                 
        <td class="status-cell" data-field="user_comment_state">{{ '✔️' if paper.user_trace and (paper.user_trace|string).strip() else '❌' }}</td> 
        <td class="toggle-btn" onclick="toggleDetails(this)"><span>Show</span></td>
    </tr>
    <tr class="detail-row">
        <td colspan="38">
            <div class="detail-content-placeholder"> 
                <!-- Content will be loaded dynamically -->
            </div>
        </td>
    </tr>
{% endfor %}
</tbody>
{% endblock %}
```

```html
# templates\papers_table_static_export.html
{% block papers_table_static_export %}
<tbody style="position: relative;">
<tr>
    <td style="padding:0;">
        <div class="loading-overlay">
            <div class="header-branding"><span>Research</span><span style="font-weight: 600; color: var(--primary-ui-color);">Parça</span></div>
            <div class="loading-spinner"></div>
            <div>Reprocessing table. Wait patiently. </div>
        </div>
    </td>
</tr>
{% for paper in papers %}
    <tr data-paper-id="{{ paper.id }}" >
        <td class="status-cell" title="{{ paper.type }}">{{ type_emojis.get(paper.type, default_type_emoji) }} 
        </td><td class="title-cell">
            {% if paper.doi %}
                <a href="https://doi.org/{{ paper.doi }}" target="_blank">{{ paper.title }}</a>
            {% else %}
                {{ paper.title }}
            {% endif %}
        </td>
        <td class="secondary-text-cell number-cell" style="width:28px; min-width:28px; max-width:28px">{{ paper.year or '' }}</td>
        <td class="secondary-text-cell">{{ paper.journal }}</td>        
        <td class="secondary-text-cell number-cell">{{ paper.page_count or '' }}</td>
        <td class="status-cell editable-status" data-field="is_offtopic">{{ paper.is_offtopic | render_status }}</td>
        <td class="secondary-text-cell number-cell">{{ paper.relevance or '' }}</td>
        <td class="status-cell editable-status" data-field="is_survey">{{ paper.is_survey | render_status }}</td>
        <td class="status-cell editable-status" data-field="is_through_hole">{{ paper.is_through_hole | render_status }}</td>
        <td class="status-cell editable-status" data-field="is_smt">{{ paper.is_smt | render_status }}</td>
        <td class="status-cell editable-status" data-field="is_x_ray">{{ paper.is_x_ray | render_status }}</td>
        <td class="status-cell editable-status highlight-status" data-field="features_tracks">{{ paper.features.tracks | render_status }}</td>
        <td class="status-cell editable-status highlight-status" data-field="features_holes">{{ paper.features.holes | render_status }}</td>
        <td class="status-cell editable-status"  data-field="features_solder_insufficient">{{ paper.features.solder_insufficient | render_status }}</td>
        <td class="status-cell editable-status"  data-field="features_solder_excess">{{ paper.features.solder_excess | render_status }}</td>
        <td class="status-cell editable-status"  data-field="features_solder_void">{{ paper.features.solder_void | render_status }}</td>
        <td class="status-cell editable-status"  data-field="features_solder_crack">{{ paper.features.solder_crack | render_status }}</td>
        <td class="status-cell editable-status highlight-status" data-field="features_missing_component">{{ paper.features.missing_component | render_status }}</td>
        <td class="status-cell editable-status highlight-status" data-field="features_wrong_component">{{ paper.features.wrong_component | render_status }}</td>
        <td class="status-cell editable-status highlight-status" data-field="features_orientation">{{ paper.features.orientation | render_status }}</td>
        <td class="status-cell editable-status highlight-status" data-field="features_cosmetic">{{ paper.features.cosmetic | render_status }}</td>
        <td class="status-cell highlight-status" data-field="features_other_state">{{ '✔️' if paper.features.other and (paper.features.other|string).strip() else '❌' }}</td>
        <td class="status-cell editable-status" data-field="technique_classic_cv_based">{{ paper.technique.classic_cv_based | render_status }}</td>
        <td class="status-cell editable-status" data-field="technique_ml_traditional">{{ paper.technique.ml_traditional | render_status }}</td>
        <td class="status-cell editable-status" data-field="technique_dl_cnn_classifier">{{ paper.technique.dl_cnn_classifier | render_status }}</td>
        <td class="status-cell editable-status" data-field="technique_dl_cnn_detector">{{ paper.technique.dl_cnn_detector | render_status }}</td>
        <td class="status-cell editable-status" data-field="technique_dl_rcnn_detector">{{ paper.technique.dl_rcnn_detector | render_status }}</td>
        <td class="status-cell editable-status" data-field="technique_dl_transformer">{{ paper.technique.dl_transformer | render_status }}</td>
        <td class="status-cell editable-status" data-field="technique_dl_other">{{ paper.technique.dl_other | render_status }}</td>
        <td class="status-cell editable-status" data-field="technique_hybrid">{{ paper.technique.hybrid | render_status }}</td>
        <td class="status-cell editable-status highlight-status" data-field="technique_available_dataset">{{ paper.technique.available_dataset | render_status }}</td>
        <td class="secondary-text-cell changed-cell highlight-status">{{ paper.changed_formatted }}</td>
        <td class="status-cell changed-by-cell highlight-status" data-field="changed_by">{{ paper.changed_by | render_changed_by }}</td>           
        <td class="status-cell editable-status" data-field="verified">{{ paper.verified | render_status }}</td>
        <td class="secondary-text-cell number-cell" data-field="verified">{{ paper.estimated_score  or '' }}</td>
        <td class="status-cell editable-verify" data-field="verified_by">{{ paper.verified_by | render_verified_by }}</td>                 
        <td class="status-cell" data-field="user_comment_state">{{ '✔️' if paper.user_trace and (paper.user_trace|string).strip() else '❌' }}</td> 
        <td class="toggle-btn" onclick="toggleDetails(this)"><span>Show</span></td>
    </tr>
    <tr class="detail-row">
        <td colspan="38">
            <div class="detail-flex-container">
                <div class="detail-content detail-abstract">
                    <p><strong>Abstract:</strong> {{ paper.abstract or 'No abstract available.' }}</p>
                </div>
                <div class="detail-content detail-metadata">
                    <p><strong>Keywords:</strong> {{ paper.keywords }}</p>
                    <p><strong>Type:</strong> {{ paper.type }}</p>
                    <p><strong>DOI:</strong>
                        {% if paper.doi %}
                            <a href="https://doi.org/{{ paper.doi }}" target="_blank">{{ paper.doi }}</a>
                        {% else %}
                            {{ paper.doi }}
                        {% endif %}
                    </p>
                    <p><strong>ISSN:</strong> {{ paper.issn }}</p>
                    <p><strong>Pages:</strong> {{ paper.pages }}</p>
                    <p><strong>ID:</strong> {{ paper.id }}</p>
                    <p><strong>Full Authors:</strong> {{ paper.authors }}</p>
                    <p><strong>Year:</strong> {{ paper.year }}</p>
                </div>
                <div class="edit-section detail-edit">
                    <form id="form-{{ paper.id }}" data-paper-id="{{ paper.id }}">
                        <label>Research Area:
                            <input type="text" class="editable" name="research_area" value="{{ paper.research_area or '' }}" disabled>
                        </label>
                        <label>Model Name:
                            <input type="text" class="editable" name="model_name" value="{{ paper.technique.model or '' }}" disabled>
                        </label>
                        <label>Other defects:
                            <input type="text" class="editable" name="features_other" value="{{ paper.features.other or '' }}" disabled>
                        </label>
                        <label>Page count:
                            <input type="text" class="editable" name="page_count" value="{{ paper.page_count or '' }}" disabled>
                        </label>
                        <label>Relevance:
                            <input type="text" class="editable" name="relevance" value="{{ paper.relevance or '' }}" placeholder="0 - 10" disabled>
                        </label>
                        <label>User comments:
                            <textarea class="editable" name="user_trace" disabled>{{ paper.user_trace or '' }}</textarea>
                        </label>
                        <div class="row-actions">
                            <button type="button" class="action-btn classify-btn" data-paper-id="{{ paper.id }}" disabled>Classify <strong>this paper</strong></button>
                            <button type="button" class="action-btn verify-btn" data-paper-id="{{ paper.id }}" disabled>Verify <strong>this paper</strong></button>
                            <button type="button" class="action-btn save-btn" onclick="saveChanges('{{ paper.id }}')" disabled>Save Changes</button>
                        </div>
                    </form>
                </div>
                <div class="detail-content detail-trace detail-evaluator-trace">
                    <strong>Evaluator Reasoning Trace:</strong>
                    <div class="trace-content">{{ paper.reasoning_trace or 'No trace available.' }}</div>
                </div>
                <div class="detail-content detail-trace detail-verifier-trace">
                    <strong>Verifier Reasoning Trace:</strong>
                    <div class="trace-content">{{ paper.verifier_trace or 'No trace available.' }}</div>
                </div>
            </div>
        </td>
    </tr>
{% endfor %}
</tbody>
{% endblock %}
```

```html
# templates\papers_table_tfoot.html
<!-- templates/papers_table_tfoot.html -->
<tfoot id="counts-footer">
    <tr>
        <!-- Empty cells to align with non-count columns -->
        <td></td> <!-- Type -->
        <td style="font-weight: 400;" id="visible-count-cell">Filtered: <span style="font-weight: bold;" id="visible-papers-count"></span>, Loaded: <span style="font-weight: bold;" id="loaded-papers-count"></span>, Total: <span style="font-weight: bold;" id="total-papers-count">{{ total_paper_count | safe }}</span></td> <!-- Title -->
        <!-- <td></td> Authors -->
        <td></td> <!-- Year -->
        <td></td> <!-- Journal -->
        <td></td> <!-- Page Count -->
        <!-- Classification Counts -->
        <td id="count-is_offtopic" class="count-cell"></td>
        <td></td> <!-- Relevance -->
        <td id="count-is_survey" class="count-cell"></td>
        <td id="count-is_through_hole" class="count-cell"></td>
        <td id="count-is_smt" class="count-cell"></td>
        <td id="count-is_x_ray" class="count-cell"></td>
        
        <!-- Features Counts (Updated list - 10 columns now) -->
        <td id="count-features_tracks" class="count-cell"></td>
        <td id="count-features_holes" class="count-cell"></td>
        <td id="count-features_solder_insufficient" class="count-cell"></td>
        <td id="count-features_solder_excess" class="count-cell"></td>
        <td id="count-features_solder_void" class="count-cell"></td>
        <td id="count-features_solder_crack" class="count-cell"></td>
        <td id="count-features_missing_component" class="count-cell"></td>
        <td id="count-features_wrong_component" class="count-cell"></td>
        <td id="count-features_orientation" class="count-cell"></td>
        <td id="count-features_cosmetic" class="count-cell"></td>
        <td id="count-features_other_state" class="count-cell"></td>

        <!-- Techniques Counts (Updated list - 9 columns now) -->
        <td id="count-technique_classic_cv_based" class="count-cell"></td>
        <td id="count-technique_ml_traditional" class="count-cell"></td>
        <td id="count-technique_dl_cnn_classifier" class="count-cell"></td>
        <td id="count-technique_dl_cnn_detector" class="count-cell"></td>
        <td id="count-technique_dl_rcnn_detector" class="count-cell"></td>
        <td id="count-technique_dl_transformer" class="count-cell"></td>
        <td id="count-technique_dl_other" class="count-cell"></td>
        <td id="count-technique_hybrid" class="count-cell"></td>
        <td id="count-technique_available_dataset" class="count-cell"></td>

        <!-- Empty cells for remaining columns -->
        <td></td> <!-- Last Changed -->
        <td id="count-changed_by" class="count-cell"></td>
        <td id="count-verified" class="count-cell"></td>
        <td></td> <!-- Estimated Score -->
        <td id="count-verified_by" class="count-cell"></td> 
        <td id="count-user_comment_state" class="count-cell"></td> 
        <td></td> <!-- Actions -->
    </tr>
</tfoot>
```

