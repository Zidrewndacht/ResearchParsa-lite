System Design Document: ResearchParça

A. Document Purpose & Scope

Introduction

This document serves as the primary technical blueprint for the ResearchParça literature analysis tool. It provides a comprehensive overview of the system's architecture, data model, core processes, and deployment procedures. The content herein is intended for system architects, developers, and technical stakeholders involved in the development, maintenance, and extension of the application.

System Overview

ResearchParça is a sophisticated, self-contained web application designed to streamline the analysis and classification of academic literature, with a specific focus on Printed Circuit Board (PCB) inspection research. Its core mission is to transform a large corpus of bibliographic data into an interactive, searchable, and classifiable knowledge base. The system achieves this by combining a responsive web interface for data management and visualization with a powerful, locally-run Artificial Intelligence engine for automated paper classification and verification. This dual approach significantly reduces the manual effort of literature reviews, enabling researchers to identify trends, analyze methodologies, and discover knowledge gaps with high efficiency and traceability.

Architectural Principles

The design and development of ResearchParça are guided by a set of core architectural principles that prioritize performance, privacy, and user control.

* Offline-First Operation: The system is engineered to be entirely self-contained. It requires no external network access, Content Delivery Networks (CDNs), or cloud services to function. All assets, including fonts, scripts, and stylesheets, are served locally by the application's backend, ensuring full operational capability in offline environments.
* Performance Optimization: A deliberate choice was made to use vanilla JavaScript for the frontend and a lightweight Python/Flask framework for the backend. This avoids the overhead of complex frameworks, ensuring a highly responsive user experience with near-instantaneous filtering, searching, and sorting, even when managing datasets containing over 10,000 records.
* Local AI Inference: All AI-powered analysis is performed by a local llama.cpp instance. This strategic decision ensures complete data privacy (as no sensitive research data leaves the user's machine), eliminates API costs associated with cloud-based AI services, and guarantees that the analysis is reproducible and fully traceable.
* User-in-the-Loop: The system is designed to augment, not replace, the researcher. While AI automates the "grunt work" of initial classification, the researcher retains full control. Every AI-generated classification is accompanied by a transparent "chain-of-thought" reasoning trace. The user can manually override any AI decision, perform inline edits that save automatically, and add their own annotations, ensuring that human expertise remains the final arbiter.

This document will now proceed to a detailed breakdown of the system's architecture and its constituent components.


--------------------------------------------------------------------------------


1.0 System Architecture

A well-defined architecture is critical to achieving the system's principles of performance, modularity, and offline operation. ResearchParça employs a distributed component model that cleanly separates the concerns of the user interface, the application's business logic, and the AI processing services. This separation allows each component to be developed, optimized, and maintained independently.

Architectural Model

The system is composed of three primary, loosely coupled components that communicate via a well-defined API.

1. Frontend (Client): A browser-based user interface constructed with vanilla JavaScript, HTML, and CSS. It operates as a dynamic single-page application responsible for rendering the data table and statistical visualizations, handling all user interactions, and performing instantaneous client-side filtering and sorting for a fluid user experience.
2. Backend (Server): A Python-based application server built on the lightweight Flask framework. It acts as the system's central nervous system, serving the frontend application, handling RESTful API requests from the client, querying the SQLite database for data retrieval and persistence, and orchestrating asynchronous AI analysis tasks.
3. AI Service (Inference Engine): A local, OpenAI-compatible API endpoint provided by a llama.cpp server instance. Its sole function is to execute complex reasoning tasks on demand. The backend sends structured prompts to this service, which performs the classification and verification of papers based on their title and abstract, returning structured JSON data.

Technology Stack Summary

The following table summarizes the key technologies utilized in each layer of the ResearchParça architecture.

Layer	Technology	Description
Frontend	Vanilla JavaScript	Chosen for maximum performance and zero framework dependencies.
	Chart.js	Used for rendering interactive and dynamic statistical charts in the UI.
	HTML5 / CSS3	Provides the structure and responsive styling for the user interface.
Backend	Flask	A lightweight Python web framework serving the API and the frontend client.
	SQLite	A file-based SQL database for data persistence, utilizing FTS5 for search.
	Openpyxl	A Python library used for generating .xlsx spreadsheet exports in memory.
AI Integration	llama.cpp	A high-performance C++ inference engine for local LLM execution.
	Qwen3-30B-A3B-Thinking-2507	The specific LLM used for classification and verification reasoning tasks.

This high-level architecture is supported by a carefully designed data model, which defines the contract for how these components store and exchange information. The next section details this foundational data schema.


--------------------------------------------------------------------------------


2.0 Data Model and Persistence

The data model is the foundational core of the ResearchParça system, defining the structure for all bibliographic, classification, and audit information. The system uses a single, central table within an SQLite database, providing a simple yet powerful schema for storing and querying all relevant paper data.

Database Engine

The system utilizes SQLite as its database engine. This choice was made for its lightweight, serverless, and file-based nature, which aligns perfectly with the project's self-contained, offline-first architectural principle. The database is configured with PRAGMA journal_mode = WAL (Write-Ahead Logging) to improve concurrency between read and write operations. For efficient text searching, especially within JSON fields, the system leverages SQLite's FTS5 (Full-Text Search) virtual tables. This extension is critical for enabling the high-performance, multi-column search functionality described in Section 4.4, as it allows for indexed querying directly against text content within the features and technique JSON columns.

 Table Schema

All data is stored within a single table named papers. The schema below details each column, its data type, and its purpose within the application.

Column Name	Data Type	Constraints	Description
id	TEXT	PRIMARY KEY	The unique BibTeX key for the entry.
type	TEXT		The publication type (e.g., 'article', 'inproceedings').
title	TEXT		The title of the paper.
authors	TEXT		A semicolon-separated list of author names.
year	INTEGER		The publication year.
page_count	INTEGER		The total number of pages in the paper.
doi	TEXT		The Digital Object Identifier.
abstract	TEXT		The full abstract of the paper.
keywords	TEXT		A semicolon-separated list of keywords.
is_offtopic	INTEGER		A boolean flag (1=true, 0=false, NULL=unknown) indicating relevance.
relevance	INTEGER		A score from 0-10 indicating relevance to the research topic.
is_survey	INTEGER		A boolean flag for survey/review papers.
is_through_hole	INTEGER		A boolean flag for Through-Hole Technology (THT) topics.
is_smt	INTEGER		A boolean flag for Surface-Mount Technology (SMT) topics.
is_x_ray	INTEGER		A boolean flag for X-ray inspection topics.
features	TEXT		A JSON object containing boolean flags for specific defect types.
technique	TEXT		A JSON object containing boolean flags for technical approaches.
changed	TEXT		An ISO 8601 timestamp of the last modification.
changed_by	TEXT		Identifier of the last modifier ('user' or LLM alias).
verified	INTEGER		A boolean flag (1=true, 0=false, NULL=unknown) indicating verification status.
estimated_score	INTEGER		The verifier LLM's confidence score (0-10).
verified_by	TEXT		Identifier of the verifier ('user' or LLM alias).
reasoning_trace	TEXT		The full chain-of-thought text from the classifier LLM.
verifier_trace	TEXT		The full chain-of-thought text from the verifier LLM.
user_trace	TEXT		Free-text user comments or annotations.

JSON Data Structures

The features and technique columns store structured data as JSON text objects. This provides flexibility for adding new classification criteria without altering the database schema. The default structures for these fields upon data ingestion are as follows:

features JSON Object:

{
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
}


technique JSON Object:

{
    "classic_cv_based": null,
    "ml_traditional": null,
    "dl_cnn_classifier": null,
    "dl_cnn_detector": null,
    "dl_rcnn_detector": null,
    "dl_transformer": null,
    "dl_other": null,
    "hybrid": null,
    "model": null,
    "available_dataset": null
}


With the data schema established, the system requires a well-defined interface to manage data access and enforce business logic. The following section specifies the backend API that provides this crucial layer of abstraction.


--------------------------------------------------------------------------------


3.0 Backend Design & API Endpoints

The backend, built using the Python Flask framework, serves as the system's nerve center. It is responsible for serving the frontend single-page application, handling all client-side AJAX requests, managing database interactions, orchestrating computationally intensive calls to the AI service, and generating data exports.

API Endpoint Specification

The system exposes a set of RESTful API endpoints to facilitate communication between the frontend client and the backend server. The table below documents each endpoint, its HTTP method, and its primary function.

Method	Endpoint	Description
GET	/	Renders the main index.html page and serves the initial, filtered set of papers.
GET	/load_table	Fetches an HTML fragment of the papers table via AJAX, based on server-side filters.
GET	/get_detail_row	Lazily loads the HTML content for an expanded detail row for a single paper.
POST	/update_paper	Handles AJAX requests to update a paper's data fields from both inline edits and the detail form.
POST	/classify	Triggers the AI classification process for a single paper or a batch (all or remaining).
POST	/verify	Triggers the AI verification process for a single paper or a batch (all or remaining).
POST	/upload_bibtex	Receives a .bib file upload, parses it, and imports new papers into the database.
GET	/get_stats	Calculates and returns statistical data (e.g., keyword counts, author frequencies) based on current filters.
GET	/static_export	Generates and serves a self-contained, interactive HTML snapshot of the current view.
GET	/xlsx_export	Generates and serves an .xlsx file of the current view, with conditional formatting.
GET	/citation_export	Generates and serves a .txt file with formatted citations for the current view.

These endpoints provide a comprehensive interface for all of the system's core functionalities. The next section will detail the specific workflows that these endpoints enable, showing how they combine to execute complex tasks.


--------------------------------------------------------------------------------


4.0 Core System Processes & Workflows

This section details the primary operational workflows of the ResearchParça system, illustrating how the architectural components and API endpoints work in concert to deliver the application's core features, from data ingestion to AI-powered analysis and export.

Data Ingestion Workflow

New papers are added to the system through a BibTeX import process, handled by the import_bibtex.py script and triggered by the /upload_bibtex API endpoint.

1. A user uploads a .bib file through the web interface.
2. The backend receives the file and parses its contents using the bibtexparser library.
3. Key fields such as author names (from author) and keywords (from keywords) are normalized into standardized, semicolon-separated lists.
4. The page count is calculated, prioritizing the numpages field and falling back to a calculation based on the pages field.
5. A new record is inserted into the papers table. The features and technique fields are populated with their default JSON structures, and other classification fields are initialized to NULL.
6. The process includes robust duplicate detection. It first checks for an existing entry with the same DOI. If no DOI is present or matched, it performs a fallback check for an entry with an identical title and year.

AI Analysis Workflow (Two-Stage Pipeline)

The core AI-driven analysis is a two-stage pipeline designed for accuracy, transparency, and quality assurance. Both stages can be initiated for a single paper, all papers, or only those that have not yet been processed.

4.2.1 Stage 1: Classification

* Process Description: The classification workflow is managed by the automate_classification.py script. The run_classification function retrieves a list of paper IDs to be processed (all, remaining, or a single id). To handle this workload efficiently, it uses a ThreadPoolExecutor to create a pool of process_paper_worker threads, enabling parallel processing. Each worker thread performs the following steps:
  1. Retrieves a paper's metadata (title, abstract, keywords, etc.) from the database.
  2. Builds a detailed prompt using the content from prompt_template.txt.
  3. Sends the prompt to the local llama.cpp server.
  4. Parses the JSON response from the LLM, which contains the classification ballot and a chain-of-thought reasoning trace.
  5. Updates the corresponding paper record in the database using the update_paper_from_llm function, storing both the classification data and the full reasoning trace. The storage of this verbatim reasoning_trace is a direct implementation of the User-in-the-Loop principle, ensuring complete transparency and allowing researchers to audit the AI's decision-making process.
* Classification Prompt: The exact prompt sent to the LLM provides detailed instructions, field definitions, and examples to guide the model's output.

4.2.2 Stage 2: Verification

* Process Description: The verification workflow, managed by verify_classification.py, provides a critical quality check on the initial classification. Its structure is analogous to the classification stage, utilizing a thread pool for parallel processing. However, its purpose is different: the verifier LLM is provided with the original paper data plus the full output of the classification stage. It is tasked with assessing the accuracy of the classifier's output and returning a simple JSON object containing a verified flag and an estimated_score of the classification's quality. This result, along with the verifier's own reasoning trace, is saved to the database.
* Verification Prompt: The instructions for the verifier LLM are tailored to its role as a quality assurance agent.

Filtering & Search Logic

The system employs a hybrid filtering strategy to balance performance with user interface responsiveness.

* Server-Side Filtering: Core filters that significantly reduce the dataset size are applied at the SQL level within the fetch_papers function. These include the publication year range, the minimum page count, and the "off-topic" flag. This ensures that the browser only receives a manageable subset of data, which is critical for performance with large corpora.
* Client-Side Filtering: UI toggles for specific categories (e.g., hiding X-ray papers, showing only surveys, or filtering by feature groups like "Solder" or "PCBA") operate instantly in the browser using JavaScript. This provides a highly responsive feel, as these actions do not require a full page reload or a new request to the server.
* Full-Text Search: A single "omnisearch" box allows users to query multiple text-based columns simultaneously (title, abstract, keywords, user comments, etc.). To achieve high-speed searching, the system leverages SQLite's FTS5 virtual tables. These tables maintain a pre-built index of text content. FTS5 is specifically configured to index the free-text values of the other key within the features JSON and the model key within the technique JSON, enabling fast searches for custom defect types and model names.

Data Export Workflow

ResearchParça provides two primary methods for exporting the currently filtered view of the data.

* HTML Snapshot: The /static_export endpoint generates a fully self-contained, interactive HTML file. The backend fetches the filtered data, renders it into a static HTML template, and then embeds all necessary CSS and JavaScript assets directly into the page. This content is minified, compressed with gzip, and encoded as a Base64 string. The final deliverable is a small loader.html file containing a script that decompresses and renders the full, interactive snapshot in any modern browser, completely offline.
* Excel Export: The /xlsx_export endpoint generates a formatted .xlsx file in memory using the openpyxl library. This export includes all data fields for the currently filtered papers. To enhance readability and facilitate analysis in spreadsheet software, boolean values are represented with conditional formatting: cells containing TRUE are given a light green background, while FALSE cells are colored light red.

The discussion will now shift from these backend processes to the frontend implementation that presents these powerful capabilities to the researcher.


--------------------------------------------------------------------------------


5.0 Frontend Design & Implementation

The frontend is architected with performance, simplicity, and interactivity as its primary goals. It is built using vanilla JavaScript, HTML, and CSS to create a highly interactive and responsive single-page application experience. This deliberate choice eschews framework overhead, ensuring the browser's main thread remains unburdened and guaranteeing a fluid UI even when rendering thousands of data rows.

User Interface Components

The user interface is composed of several key interactive components:

* Main Data Table: A wide, horizontally scrollable table serves as the primary data view. To maintain context, the first few columns (Type, Title, Year, Journal/Conf, Pages) are "frozen" and remain visible during horizontal scrolling. All column headers are clickable, allowing for ascending and descending sorts.
* Filter & Control Bar: A persistent header section contains all primary controls. This includes server-side filters (year range, page count), client-side toggle checkboxes (X-ray, surveys, feature groups), the omnisearch box, and action buttons for accessing Statistics, Export functions, and the "ParçaTools" AI batch processing menu.
* Detail Row Drawer: A collapsible sub-row is available for each paper, which is lazy-loaded via an AJAX call to the /get_detail_row endpoint only when the user clicks "Show." This drawer contains the full abstract, detailed metadata, the complete AI reasoning and verifier traces, and an editable form for custom fields like research area and user comments.
* Statistics Modal: A modal window that displays dynamic charts and frequency lists (e.g., top authors, keywords, journals). All visualizations are generated based on the current state of the filtered data, providing real-time analytical insights.

Client-Side Logic Breakdown

The frontend's interactive logic is organized into several dedicated JavaScript files:

* filtering.js: This script is the engine for the primary, interactive application's user experience. It manages all client-side filtering logic (via toggle checkboxes), handles multi-column table sorting, and performs dynamic UI updates such as applying alternating row shading. It is also responsible for triggering server-side filter reloads when appropriate.
* ghpages.js: This script is a self-contained version of the filtering logic embedded within the static HTML snapshot generated by the export function. It provides the same sorting and client-side filtering capabilities, but operates entirely within the browser on the exported data, with no backend communication.
* comms.js: This script acts as the central communication hub, managing all AJAX (fetch) requests to the backend. Its responsibilities include sending data for inline edits (e.g., cycling a status symbol), triggering single-paper or batch AI jobs via the /classify and /verify endpoints, and handling the lazy-loading of detail row content.
* stats.js: This script is responsible for the analytics functionality. It fetches statistical data from the /get_stats endpoint and uses the Chart.js library to render the various bar and line charts presented within the statistics modal window.

Performance & Responsiveness

Several techniques are employed to ensure a high-performance user experience:

* Lazy Loading: To minimize the initial page load time and reduce the amount of data transferred, the content for the detail row drawers is not included in the initial HTML payload. It is only fetched from the server when a user explicitly clicks the "Show" button for a specific paper.
* Debouncing: User input events, particularly typing in the search bar, are debounced. This practice prevents the application from sending an excessive number of API calls to the server while the user is typing, instead waiting for a brief pause before initiating the search.
* Instant Feedback: Client-side actions like applying toggle filters or performing inline status-cycling edits provide immediate visual feedback to the user. The communication with the server to persist these changes happens asynchronously in the background, making the UI feel instantaneous.

Having explored the frontend that surfaces the system's capabilities, the final section of this document will cover the practical aspects of configuring and running the application.


--------------------------------------------------------------------------------


6.0 Configuration and Deployment

This section covers the necessary configuration parameters and the steps required to launch and operate the ResearchParça application.

System Configuration

The central configuration for the application is managed in the globals.py file. This file contains key variables that may need to be adjusted depending on the deployment environment.

Variable	File	Description
LLM_SERVER_URL	globals.py	The base URL for the local OpenAI-compatible AI server (e.g., http://localhost:8080).
DATABASE_FILE	globals.py	The path to the SQLite database file (e.g., new.sqlite).
MAX_CONCURRENT_WORKERS	globals.py	The number of parallel threads to use for batch classification and verification tasks.
PROMPT_TEMPLATE	globals.py	Path to the text file containing the prompt for the classifier LLM.
VERIFIER_TEMPLATE	globals.py	Path to the text file containing the prompt for the verifier LLM.

Startup and Operation

Follow these steps to run the complete ResearchParça application:

1. Launch AI Service: First, start the local llama.cpp server with the specified Qwen3 model. Ensure that the server is running and accessible at the URL defined in the LLM_SERVER_URL configuration variable.
2. Launch Web Application: Start the main application by executing the following command from the project's root directory in a terminal: python browse_db.py [path_to_db.sqlite] If a path to a database file is not provided, it will use the default specified in globals.py.
3. Access UI: Upon a successful launch, the Flask server will be available at http://127.0.0.1:5000. A web browser window should open automatically to this address.
4. Batch Processing: For convenience, several batch scripts are provided to run AI tasks directly from the command line without needing to use the UI. These include !classify_and_verify_remaining.bat and !reclassify_and_verify_all.bat, which serve as shortcuts for initiating large-scale classification and verification jobs.
