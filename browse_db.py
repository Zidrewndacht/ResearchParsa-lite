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
    filename_parts = ["PCBPapers"]
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
    filename_parts = ["PCBPapers"]
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
    filename_parts = ["PCBPapers_Citations"]
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