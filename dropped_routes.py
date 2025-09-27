
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





# this will be replaced by serve_annotator:
@app.route('/serve_pdf/<filename>')
def serve_pdf(filename):
    """Serves a PDF file from the data/pdf directory."""
    # Validate filename to prevent path traversal
    if '..' in filename or filename.startswith('/'):
        abort(404) # Or return a 400 error
    filepath = os.path.join(globals.PDF_STORAGE_DIR, filename)
    if os.path.exists(filepath) and os.path.isfile(filepath):
        # Use send_from_directory for security
        return send_from_directory(globals.PDF_STORAGE_DIR, filename, as_attachment=False) # as_attachment=False opens in browser
    else:
        print(f"Requested PDF file not found: {filepath}")
        abort(404) # File not found


