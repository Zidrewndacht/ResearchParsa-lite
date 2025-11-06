# import_bibtex.py
import sqlite3
import bibtexparser
from bibtexparser.bparser import BibTexParser
from bibtexparser.customization import homogenize_latex_encoding
import argparse
import re 
import csv
from typing import List

def create_database(db_path):
    """Create SQLite database with a generic schema"""
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
        -- Generic classification fields (can be used for any domain)
        research_area TEXT,                -- NULL = unknown
        is_offtopic INTEGER,               -- 1=true, 0=false, NULL=unknown
        relevance INTEGER,                 -- New field: 0 for offtopic, 10 for ontopic (generic scale)
        is_survey INTEGER,                 -- 1=true, 0=false, NULL=unknown
        -- Audit fields
        changed TEXT,                      -- ISO 8601 timestamp, NULL if never changed
        changed_by TEXT,                   -- Identifier of the changer (e.g., 'Web app')
        verified INTEGER,                  -- 1=true, 0=false, NULL=unknown
        verified_by TEXT,                  -- Identifier of the verifier (e.g., 'user')
        reasoning_trace TEXT,              -- For evaluator reasoning traces (generic)
        verifier_trace TEXT,               -- For verifier reasoning traces (generic)
        user_trace TEXT,                   -- User comments (generic).
        pdf_filename TEXT DEFAULT NULL,
        pdf_state TEXT DEFAULT 'none'      -- 'none', 'annotated', 'PDF'
    )
    ''')
    cursor.execute('PRAGMA journal_mode = WAL')
    conn.commit()
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









def clean_bibtex_key(text: str) -> str:
    """Clean text to create a valid BibTeX key."""
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s-]+', '_', text)
    text = text.strip('_')
    if text and not text[0].isalpha():
        text = 'key_' + text
    text = text[:50]
    return text

def clean_authors(authors_str: str) -> str:
    """Convert authors from semicolon-separated format to BibTeX format."""
    if not authors_str:
        return ""
    
    authors = authors_str.split(';')
    cleaned_authors = []
    
    for author in authors:
        author = author.strip()
        if ',' in author:
            parts = author.split(',')
            if len(parts) >= 2:
                last_name = parts[0].strip()
                first_name = parts[1].strip()
                cleaned_authors.append(f"{last_name}, {first_name}")
            else:
                cleaned_authors.append(author)
        else:
            name_parts = author.split()
            if len(name_parts) >= 2:
                last_name = name_parts[-1]
                first_name = ' '.join(name_parts[:-1])
                cleaned_authors.append(f"{last_name}, {first_name}")
            else:
                cleaned_authors.append(author)
    
    return " and ".join(cleaned_authors)

def clean_title(title: str) -> str:
    """Clean title for BibTeX format."""
    if not title:
        return ""
    
    title = title.replace('{', '\\{').replace('}', '\\}')
    title = title.replace('#', '\\#')
    title = title.replace('$', '\\$')
    title = title.replace('%', '\\%')
    title = title.replace('&', '\\&')
    title = title.replace('_', '\\_')
    title = title.replace('^', '\\^')
    title = title.replace('~', '\\~')
    
    return title

def escape_bibtex_field(text: str) -> str:
    """Escape special characters in BibTeX fields."""
    if not text:
        return ""
    
    text = text.replace('{', '\\{').replace('}', '\\}')
    text = text.replace('#', '\\#')
    text = text.replace('$', '\\$')
    text = text.replace('%', '\\%')
    text = text.replace('&', '\\&')
    text = text.replace('_', '\\_')
    text = text.replace('^', '\\^')
    text = text.replace('~', '\\~')
    text = text.replace('\\', '\\textbackslash{}')
    
    return text

def extract_month_from_date(date_str: str) -> str:
    """Extract month from date string like '30 May 2025'."""
    if not date_str:
        return ""
    
    try:
        # Split and try to extract month
        parts = date_str.split()
        if len(parts) >= 2:
            month_str = parts[1].lower()
            month_map = {
                'january': 'jan', 'february': 'feb', 'march': 'mar', 'april': 'apr',
                'may': 'may', 'june': 'jun', 'july': 'jul', 'august': 'aug',
                'september': 'sep', 'october': 'oct', 'november': 'nov', 'december': 'dec',
                'jan': 'jan', 'feb': 'feb', 'mar': 'mar', 'apr': 'apr',
                'jun': 'jun', 'jul': 'jul', 'aug': 'aug', 'sep': 'sep',
                'oct': 'oct', 'nov': 'nov', 'dec': 'dec'
            }
            return month_map.get(month_str, "")
    except:
        pass
    return ""


def convert_csv_to_bibtex(csv_file_path: str) -> List[str]:
    """Convert a single CSV file to BibTeX entries."""
    bibtex_entries = []
    
    with open(csv_file_path, 'r', encoding='utf-8') as csvfile:
        reader = csv.DictReader(csvfile)
        
        for row_idx, row in enumerate(reader):
            try:
                # Create a unique key for the entry
                title = row.get("Document Title", "")
                authors = row.get("Authors", "")
                
                if authors:
                    first_author = authors.split(';')[0].strip() if ';' in authors else authors.strip()
                    first_author_name = first_author.split()[-1] if first_author.split() else "Unknown"
                else:
                    first_author_name = "Unknown"
                
                year = row.get("Publication Year", "0000")
                title_part = clean_bibtex_key(title[:20]) if title else "title"
                
                key = f"{first_author_name}{year}{title_part}"
                
                # Ensure key is unique
                original_key = key
                counter = 1
                while any(entry.startswith(f"@article{{{key}") or 
                         entry.startswith(f"@inproceedings{{{key}") or 
                         entry.startswith(f"@conference{{{key}") or 
                         entry.startswith(f"@book{{{key}") for entry in bibtex_entries):
                    key = f"{original_key}{counter}"
                    counter += 1
                
                # Determine entry type using the Document Identifier field
                doc_identifier = row.get("Document Identifier", "").strip().lower()
                if "conference" in doc_identifier:
                    entry_type = "inproceedings"
                elif "journal" in doc_identifier:
                    entry_type = "article"
                else:
                    # Fallback: try to determine from Publication Title if Document Identifier is not available
                    pub_title = row.get("Publication Title", "").lower()
                    if "conference" in pub_title or "inproceeding" in pub_title or "proceeding" in pub_title:
                        entry_type = "inproceedings"
                    elif "journal" in pub_title or "trans" in pub_title:
                        entry_type = "article"
                    else:
                        entry_type = "article"
                
                # Start building the BibTeX entry
                bibtex_entry = f"@{entry_type}{{{key},\n"
                
                # Add title
                if title:
                    bibtex_entry += f"  title = {{{clean_title(title)}}},\n"
                
                # Add authors
                if authors:
                    bibtex_entry += f"  author = {{{clean_authors(authors)}}},\n"
                
                # Add journal/booktitle
                pub_title = row.get("Publication Title", "")
                if pub_title:
                    if entry_type == "inproceedings":
                        bibtex_entry += f"  booktitle = {{{escape_bibtex_field(pub_title)}}},\n"
                    else:
                        bibtex_entry += f"  journal = {{{escape_bibtex_field(pub_title)}}},\n"
                
                # Add year
                if year and year != "0000":
                    bibtex_entry += f"  year = {{{year}}},\n"
                
                # Add month
                date_added = row.get("Date Added To Xplore", "")
                if date_added:
                    month = extract_month_from_date(date_added)
                    if month:
                        bibtex_entry += f"  month = {{{month}}},\n"
                
                # Add volume if available
                volume = row.get("Volume", "").strip()
                if volume:
                    bibtex_entry += f"  volume = {{{volume}}},\n"
                
                # Add issue as number if available
                issue = row.get("Issue", "").strip()
                if issue:
                    bibtex_entry += f"  number = {{{issue}}},\n"
                
                # Add pages if available
                start_page = row.get("Start Page", "").strip()
                end_page = row.get("End Page", "").strip()
                if start_page and end_page:
                    bibtex_entry += f"  pages = {{{start_page}--{end_page}}},\n"
                elif start_page:
                    bibtex_entry += f"  pages = {{{start_page}}},\n"
                
                # Add DOI if available
                doi = row.get("DOI", "").strip()
                if doi:
                    bibtex_entry += f"  doi = {{{doi}}},\n"
                
                # Add ISSN if available
                issn = row.get("ISSN", "").strip()
                if issn:
                    bibtex_entry += f"  issn = {{{issn}}},\n"
                
                # Add ISBN if available
                isbn = row.get("ISBNs", "").strip()
                if isbn:
                    bibtex_entry += f"  isbn = {{{isbn}}},\n"
                
                # Add publisher if available
                publisher = row.get("Publisher", "").strip()
                if publisher:
                    bibtex_entry += f"  publisher = {{{escape_bibtex_field(publisher)}}},\n"
                
                # Add abstract (the fully-featured part you wanted!)
                abstract = row.get("Abstract", "").strip()
                if abstract:
                    bibtex_entry += f"  abstract = {{{escape_bibtex_field(abstract)}}},\n"
                
                # Add keywords from IEEE Terms (as keyword field)
                ieee_terms = row.get("IEEE Terms", "").strip()
                if ieee_terms:
                    # Convert semicolon-separated terms to comma-separated keywords
                    keywords = ieee_terms.replace(';', ',').replace('|', ',')
                    bibtex_entry += f"  keywords = {{{escape_bibtex_field(keywords)}}},\n"
                
                # Add author keywords if available
                author_keywords = row.get("Author Keywords", "").strip()
                if author_keywords:
                    if ieee_terms:  # If we already have keywords, append to them
                        all_keywords = f"{ieee_terms}, {author_keywords}"
                        all_keywords = all_keywords.replace(';', ',').replace('|', ',')
                        bibtex_entry += f"  keywords = {{{escape_bibtex_field(all_keywords)}}},\n"
                    else:
                        keywords = author_keywords.replace(';', ',').replace('|', ',')
                        bibtex_entry += f"  keywords = {{{escape_bibtex_field(keywords)}}},\n"
                
                # Add PDF link if available
                pdf_link = row.get("PDF Link", "").strip()
                if pdf_link:
                    bibtex_entry += f"  url = {{{pdf_link}}},\n"
                
                # Add note about citation counts
                citation_count = row.get("Article Citation Count", "").strip()
                if citation_count and citation_count != "0":
                    bibtex_entry += f"  note = {{Citations: {citation_count}}},\n"
                
                if row.get("Document Identifier"):
                    doc_id = row.get("Document Identifier", "").strip()
                    if doc_id:
                        bibtex_entry += f"  file = {{{doc_id}}},\n"
                
                # Add reference count as a custom field
                ref_count = row.get("Reference Count", "").strip()
                if ref_count:
                    bibtex_entry += f"  references = {{{ref_count}}},\n"
                
                # Add funding information as a custom field
                funding = row.get("Funding Information", "").strip()
                if funding:
                    bibtex_entry += f"  funding = {{{escape_bibtex_field(funding)}}},\n"
                
                # Add Mesh terms as a custom field
                mesh_terms = row.get("Mesh_Terms", "").strip()
                if mesh_terms:
                    bibtex_entry += f"  mesh = {{{escape_bibtex_field(mesh_terms)}}},\n"
                
                bibtex_entry += "}\n\n"
                bibtex_entries.append(bibtex_entry)
                
            except Exception as e:
                print(f"Error processing row {row_idx + 2} in {csv_file_path}: {e}")
                continue
    
    return bibtex_entries




# Modify the function signature to accept the default value
def import_bibtex(bib_file, db_path, default_is_survey_value=None): # Add default_is_survey_value parameter
    """Import BibTeX file into SQLite database"""
    # Configure BibTeX parser
    parser = BibTexParser(common_strings=True)
    parser.customization = homogenize_latex_encoding
    parser.ignore_nonstandard_types = False
    # Parse BibTeX file
    with open(bib_file, 'r', encoding='utf-8') as f:
        bib_db = bibtexparser.load(f, parser=parser)
    create_database(db_path)
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    for entry in bib_db.entries:
        # Prepare data for insertion
        title_raw = entry.get('title', '')
        cleaned_title = clean_latex_commands(title_raw)
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

        # Determine is_survey value: use the default passed in, otherwise keep as None (unknown)
        is_survey_value = default_is_survey_value

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
            'relevance': relevance,
            # --- SET is_survey using the default value ---
            'is_survey': is_survey_value,
            # --- END SET ---
            'changed': None,
            'changed_by': None,
            'verified': None,
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
                research_area, is_offtopic, relevance, is_survey,
                changed, changed_by, verified, verified_by, reasoning_trace, verifier_trace, user_trace
            ) VALUES (
                :id, :type, :title, :authors, :year, :month, :journal,
                :volume, :pages, :page_count, :doi, :issn, :abstract, :keywords,
                :research_area, :is_offtopic, :relevance, :is_survey,
                :changed, :changed_by, :verified, :verified_by, :reasoning_trace, :verifier_trace, :user_trace
            )
            ''', data)
        except sqlite3.IntegrityError as e:
            print(f"Warning: Skipping duplicate ID '{data['id']}' - {e}")
        except Exception as e:
            print(f"Error inserting entry '{data['id']}': {e}")

    # Check if placeholder record with id=1 exists before import
    cursor.execute("SELECT COUNT(*) FROM papers WHERE id = '1'")
    placeholder_exists = cursor.fetchone()[0] > 0
    # Delete the placeholder record with id=1 if it existed before import
    if placeholder_exists:
        cursor.execute("DELETE FROM papers WHERE id = '1'")
        print("Removed placeholder record with id=1")
    conn.commit()
    print(f"Imported {len(bib_db.entries)} records into database '{db_path}'")
    conn.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        # *** UPDATED DESCRIPTION ***
        description='Convert BibTeX to SQLite database')
    parser.add_argument('bib_file', help='Input BibTeX file path')
    parser.add_argument('db_file', help='Output SQLite database file path')
    # Note: The command-line script might need adjustment if it's expected to set the default is_survey value,
    # but the primary use case described involves the web interface.
    args = parser.parse_args()
    # Call with default is_survey as None for command-line usage, unless specified otherwise
    import_bibtex(args.bib_file, args.db_file, default_is_survey_value=None)