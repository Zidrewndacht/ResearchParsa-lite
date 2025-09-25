ResearchParça: A Technical White Paper on an AI-Augmented System for Literature Analysis

Conducting a comprehensive systematic literature review is a foundational, yet formidable, task in any specialized technical field. ResearchParça was architected to solve the critical data transformation problem inherent in this process: converting a disorganized corpus of BibTeX files and PDFs into an interactive, fully classified, and shareable knowledge base. It is an end-to-end, offline-first system designed to function as a "spreadsheet-meets-dashboard-meets-AI-intern" for researchers, with an initial focus on the domain of Printed Circuit Board (PCB) inspection.

The objective of this white paper is to provide a detailed technical examination of the ResearchParça system. We will explore its underlying design philosophy, its full-stack architecture, and its core functionalities from the perspective of both the end-user and the system architect. A central focus will be the innovative two-stage AI pipeline that powers its analytical capabilities, a system that pairs automated annotation with robust human oversight.

This document will proceed by first outlining the system's core design principles. We will then walk through the researcher's workflow, detailing the system's functional capabilities. Following this, we will perform a deep dive into the technical architecture, from the frontend to the database. Finally, we will dissect the AI annotation pipeline before offering a concluding summary of the system's impact and its validation of a replicable architectural pattern for AI-assisted research tools.


--------------------------------------------------------------------------------


1.0 System Philosophy and Core Objectives

The development of ResearchParça was driven by an architectural philosophy centered on the practical needs of academic researchers. The primary strategic decision was to engineer a turnkey, offline-first tool that empowers individual researchers without forcing reliance on external cloud services, subscriptions, or complex deployment procedures. This philosophy was born from the understanding that the most effective tools are those that minimize friction and allow a researcher to move from a "messy folder of PDFs" to an interactive, shareable, and fully classified literature review with maximum efficiency and minimal setup.

This guiding philosophy is embodied in four core design objectives:

* Turnkey Usability: The system is engineered for immediate productivity. A researcher can launch the entire web application with a single command (python browse_db.py my_db.sqlite) without needing to manage complex dependencies like Docker or npm. All required assets—fonts, CSS, and JavaScript—are served locally, eliminating reliance on external CDNs and ensuring the tool works out of the box.
* Performance and Responsiveness: A smooth user experience, especially when dealing with thousands of records, was a non-negotiable requirement. Architectural choices were deliberately made to ensure this. The frontend is built with vanilla JavaScript, avoiding framework overhead to maintain fluid scrolling. Key performance optimizations include the lazy loading of detailed paper information via AJAX calls to keep initial page loads small and the use of SQLite's FTS5 virtual tables, which provide millisecond-level full-text search performance across a corpus of tens of thousands of papers.
* Offline-First and Data Privacy: In an era of cloud-centric solutions, ResearchParça deliberately takes a local-first approach. All data is stored in a local SQLite file, and more critically, all AI inference is performed by a locally running Large Language Model (LLM) via llama.cpp. This self-contained operation completely eliminates cloud dependencies, associated costs, and any concerns regarding data privacy, as sensitive research data never leaves the researcher's own hardware.
* Reproducibility and Transparency: To uphold scholarly rigor, the system is built with transparency at its core. Every AI-driven classification stores the specific name of the LLM model used, ensuring that results can be traced back to their source. The system also captures the LLM's full chain-of-thought reasoning, providing a complete, human-readable justification for every decision. A comprehensive audit trail records every change, timestamping it and attributing it to either the user or the AI, making the entire review process transparent and reproducible.

These foundational principles directly manifest in the system's architecture and the researcher's workflow, which we will explore next.

2.0 Functional Overview: The Researcher's Workflow

This section examines the ResearchParça system from the end-user's perspective, walking through a typical workflow for a systematic literature review. The journey begins with the ingestion of raw bibliographic data and progresses through curation, interactive exploration, AI-assisted analysis, and finally, the dissemination of shareable, insightful results. Each feature is designed to support a specific phase of the research process, creating a cohesive and powerful analytical environment.

2.1 Data Ingestion and Curation

1. Data Import: The workflow begins with the bulk import of research papers using the standard BibTeX format. The backend, leveraging the pybtex library, parses .bib files, normalizes author names, and intelligently inserts new records into the database. This process is designed to be non-destructive, preserving any manual edits or classifications already made to existing entries.
2. Paper Management Interface: The central hub of the system is a comprehensive table view that displays key bibliographic information, including title, authors, publication year, and source. For at-a-glance assessment, the interface uses a simple Unicode glyph system to indicate status:
  * ✔️: Yes / True
  * ❌: No / False
  * ❔: Unknown / Not yet classified
  * 👤: Last edited by a human user
  * 🖥️: Last edited by the AI system
3. Inline Editing: To facilitate rapid curation, any boolean (✔️❌❔) cell in the table is interactive. A single click cycles the cell through its states (e.g., from ❔ to ✔️). This action triggers a background PATCH request to the server, which automatically saves the change without requiring a separate submit button, providing a seamless and efficient editing experience.

2.2 Interactive Exploration and Triage

1. Advanced Filtering: ResearchParça employs a balanced, two-tiered filtering strategy for optimal performance.
  * Server-side filters, such as year range and minimum page count, are applied at the SQL layer. This reduces the amount of data sent to the browser, ensuring responsiveness even with very large datasets.
  * Client-side toggle filters, for categories like X-ray studies or survey papers, operate instantaneously within the browser, allowing researchers to slice and view the data without any page reloads.
2. Omnisearch: A single, powerful search box provides real-time, case-insensitive AND search capabilities across a wide range of fields, including title, authors, abstract, keywords, and user-added comments. As the user types, matching text is highlighted, and the table updates in near real-time.
3. Data Exploration: The main table is fully interactive. Column headers are clickable, allowing for ascending or descending sorting. To delve deeper into a specific paper, an expandable "Show" button lazy-loads a detail drawer. This drawer contains the full abstract, complete metadata, and, crucially, the full reasoning traces from the AI classification and verification stages.
4. Shareable Views and Collaboration: Every filter state, search query, and sort order is encoded into the URL's query string. This creates a persistent link that can be shared with colleagues, allowing them to see the exact same slice of the corpus. This feature is critical for academic collaboration and reproducibility, as it enables teams to reference and discuss specific subsets of the literature with perfect fidelity.

2.3 AI-Augmented Analysis and User Oversight

1. AI-Assisted Annotation: The system's core analytical power comes from its two-stage AI pipeline. A researcher can initiate this process for a single paper directly from its detail view or in batch modes for all unclassified papers ("remaining") or the entire corpus ("all"). The AI then performs a detailed, multi-dimensional classification of the paper's content.
2. Manual Override: The system is explicitly designed to keep the researcher in ultimate control. Within the detail drawer, an editable mini-form allows the user to manually correct, supplement, or completely override any AI-generated classification. Free-text comments can also be added to capture nuanced insights or notes.
3. Audit Trail: Every change, whether made by the user or the AI, is recorded. Each modification is timestamped and attributed to its source (e.g., "user" or the specific LLM alias). The last editor is always visible in the main table, providing a clear audit trail and allowing supervisors to quickly see which papers have undergone human review.

2.4 Statistical Insights and Visualization

1. Dynamic Dashboard: The "View Statistics" feature opens a modal dashboard that provides a comprehensive analytical overview of the literature. Critically, all charts and statistics are recalculated on-the-fly based on the currently filtered set of papers, enabling highly contextualized analysis.
2. Categorical Analysis: The dashboard includes ranked lists of the most frequent journals, conferences, authors, and keywords. To visualize the distribution of research focus, it generates horizontal bar charts using Chart.js that show the prevalence of different defect features (e.g., solder voids, missing components) and technical approaches (e.g., CNN detectors, Transformers).
3. Temporal Analysis: Interactive line charts are used to track research trends over time. This includes visualizations of the evolution of survey papers versus implementation papers, as well as the changing mix of publication types (e.g., journal articles vs. conference proceedings) on a year-by-year basis.

2.5 Dissemination and Portability

1. HTML Snapshot: The "Export HTML" feature generates a single, self-contained HTML file. This file's core data payload is gzipped and base64-encoded to be embedded within a minimalist HTML loader. This technique allows a potentially multi-megabyte interactive application to be delivered as a single, compact .html file that any modern browser can decompress and render client-side without a web server. This offline snapshot preserves all client-side search, filtering, and statistical analysis functionality, making it a fully interactive and shareable artifact for collaboration or publication.
2. Excel Workbook: For researchers who need to perform further analysis, the "Export XLSX" feature produces a structured .xlsx file. In this workbook, boolean classification values are color-coded (light green for TRUE, light red for FALSE), and the data is immediately ready for advanced manipulation with tools like pivot tables.

This comprehensive set of functionalities is made possible by a deliberate and efficient technical architecture, which we will now examine in detail.

3.0 Technical Architecture Deep Dive

The architectural choices in ResearchParça were pivotal in achieving its core objectives of performance, privacy, and usability. The system was designed as a full-stack web application with a clear separation of concerns, ensuring maintainability and scalability. This section dissects the architecture, from the framework-free frontend and Python-based backend to the local database implementation that powers its high-speed search capabilities.

3.1 High-Level System Architecture

ResearchParça is composed of three primary, loosely coupled components that communicate via a RESTful API:

1. A vanilla JavaScript frontend that runs entirely in the user's browser, responsible for rendering the user interface and handling all user interactions.
2. A Flask backend server, written in Python, which serves the web application, manages the database, and orchestrates the AI pipeline.
3. A local llama.cpp inference server, which hosts the Large Language Model and exposes an OpenAI-compatible API endpoint for classification and verification tasks.

The Flask application acts as the central mediator. It handles all requests from the frontend, queries the database, and initiates requests to the LLM inference server on the user's behalf. This design ensures a clean separation between the presentation layer, business logic, and the AI engine.

3.2 Frontend Architecture

* Technology Choices: The frontend is intentionally built with vanilla JavaScript, avoiding dependencies on heavy frameworks like React or Vue. This choice maximizes performance, eliminates complex build steps, and ensures the user interface remains exceptionally responsive, even when rendering and manipulating tables with thousands of rows. For data visualization, it integrates the lightweight and powerful Chart.js library to generate dynamic and interactive charts.
* Performance Optimizations: Several key techniques are employed to maintain a smooth user experience. The initial HTML payload is kept small by lazy loading the detailed view for each paper. This content is fetched via an AJAX call only when the user clicks the "Show" button. The system also uses a balanced filtering strategy, offloading large-scale data reduction (like year ranges) to server-side filtering while using client-side toggles for instantaneous UI updates on the already-loaded data.

3.3 Backend Architecture

* Web Framework: The backend is a lightweight web application built using the Flask framework in Python. It is responsible for serving the static HTML, CSS, and JavaScript files to the browser and exposing a series of RESTful API endpoints to handle data operations.
* Database: The system utilizes a simple, file-based SQLite database, which eliminates the need for a separate database server and simplifies deployment. The key to its search performance is the FTS5 (Full-Text Search) virtual tables extension. The backend creates dedicated virtual tables (papers_features_fts, papers_technique_fts) to index the text content within the JSON-encoded features and technique columns. The omnisearch query is a hybrid: it performs fast LIKE searches on standard bibliographic columns and executes efficient MATCH searches against the FTS tables for JSON content, with all results combined via a UNION operation. This architecture delivers millisecond-level full-text search across the entire corpus.
* API Endpoints: The backend exposes a RESTful API that drives the application's functionality. Key endpoints are categorized by function:
  * Data Persistence: /update_paper (PATCH) for saving all user edits from the main table or detail form.
  * AI Orchestration: /classify and /verify (POST) to trigger single-paper or batch background AI jobs.
  * Dynamic Content: /get_stats and /get_detail_row (GET) for fetching on-the-fly analytics and lazy-loading row details.
  * Data Export: /static_export and /xlsx_export (GET) for generating and downloading shareable reports.

3.4 Database Schema

The core data is stored in a single papers table within the SQLite database. The schema, defined in import_bibtex.py, is designed for both bibliographic accuracy and analytical transparency.

Column Group	Columns	Description
Bibliographic Data	id, type, title, authors, year, journal, pages, doi, abstract, keywords	Standard fields parsed from the source BibTeX file, forming the core bibliographic record for each paper.
Classification Fields	is_offtopic, is_survey, is_through_hole, is_smt, is_x_ray	Key boolean flags stored as integers (1 for TRUE, 0 for FALSE, NULL for unknown) that provide high-level categorization, populated by either the AI or the user.
JSON-Encoded Fields	features, technique	These fields store complex, multi-dimensional classifications as JSON objects, allowing for a flexible schema that can track numerous defect types and technical approaches.
Audit & Traceability	changed, changed_by, verified, verified_by, reasoning_trace, verifier_trace, user_trace	A comprehensive set of fields critical for transparency. changed_by and verified_by log the actor responsible: either the string 'user' for manual edits or the specific model alias (e.g., Qwen3-30B-A3B-Thinking-2507).

This robust schema, particularly its audit and traceability fields, provides the foundation for the system's most innovative component: the AI annotation pipeline that populates it.

4.0 The Two-Stage AI Annotation Pipeline

The two-stage AI annotation pipeline is the most innovative component of ResearchParça, designed to automate the laborious task of literature classification with a high degree of accuracy while maintaining full transparency. Its strategic purpose is to function as an "AI intern," performing the initial, time-consuming analysis of each paper. This process is carefully architected to keep the human researcher firmly in control, acting as the final arbiter of all classifications.

4.1 Local LLM Environment

The entire AI pipeline runs on the researcher's local hardware, a design choice that ensures data privacy, eliminates API costs, and allows for fully offline operation.

* Model and Engine: The system utilizes the Qwen3-30B-A3B-Thinking-2507 model, which is optimized for reasoning tasks. Inference is handled by the high-performance llama.cpp engine, running on local hardware (e.g., a workstation with 2x RTX 3090 GPUs).
* Performance: This local setup is highly efficient, capable of processing a corpus of 13,456 papers in approximately 6 days.

4.2 Stage 1: Automated Classification

The first stage of the pipeline is the classifier, which performs the initial, detailed annotation of each paper.

* Function: The classifier is triggered by the automate_classification.py script. It reads a paper's title and abstract and generates a structured JSON object containing a multi-dimensional categorization of the work. This script uses a ThreadPoolExecutor to process papers in parallel, maximizing the throughput of the local hardware.
* Structured Output: The key to this stage is the prompt_template.txt file. This detailed prompt employs a few-shot learning approach, providing the LLM with several high-quality examples of input text and corresponding JSON output. This primes the model to act as a domain expert and produce a JSON "ballot" that strictly adheres to the database schema, including fields for research_type, pcb_technology, defect_types, and technical_approaches.
* Interpretability: A critical feature of this stage is its transparency. The system captures the LLM's entire chain-of-thought reasoning process and stores it verbatim in the reasoning_trace field in the database. This allows the researcher to see exactly why the AI made a particular classification, making its decision-making process fully interpretable.

4.3 Stage 2: Automated Verification

The second stage acts as an automated quality control check on the first stage's output, helping to identify potential misclassifications or ambiguous cases.

* Function: The verifier has a distinct role. It is provided with the original paper's text and the JSON ballot produced by the classifier in Stage 1. Its task is to critically evaluate whether the classifier's output is a faithful and accurate representation of the source material.
* Verification Prompt: The verifier_template.txt instructs this second AI instance to return another JSON object containing two key fields: a boolean verified flag and an estimated_score (from 0 to 10) representing its confidence in the classifier's accuracy.
* Conflict Resolution: If the verifier disagrees with the classifier's assessment (e.g., it sets verified to false), its own reasoning is captured and stored in the separate verifier_trace field. This provides the researcher with a rich audit trail, highlighting papers where the AI models had differing interpretations, and flagging them for human review.

4.4 Human-in-the-Loop Design

The entire AI pipeline is architected to ensure the human researcher remains the final authority.

* The AI pipeline performs the initial "grunt work," saving the researcher weeks of manual effort. However, its outputs are treated as suggestions, not final truths.
* The user interface provides seamless manual override capabilities for every single classification field. From simple boolean toggles to free-text fields for model names or comments, the researcher can easily correct, refine, or supplement the AI's work.
* This powerful combination of transparent AI reasoning, automated verification, and direct user control is what makes ResearchParça a trustworthy and highly effective tool for accelerating rigorous academic research.

5.0 Conclusion: A Framework for AI-Assisted Research

ResearchParça successfully integrates a performant full-stack architecture—from its framework-free vanilla JavaScript frontend to its efficient Flask and SQLite backend—with an innovative, local-first, two-stage AI pipeline. This design provides a powerful, private, and cost-effective solution for systematic literature analysis, reducing a manual classification task of weeks into a matter of days and enabling large-scale, reproducible trend analysis that would be manually impractical.

Ultimately, ResearchParça validates a powerful architectural pattern for domain-specific, AI-augmented research: a framework-free, high-performance frontend coupled with a lightweight Python backend and a decoupled, local inference engine. This stack provides a replicable blueprint for developing specialized research tools that prioritize performance, data privacy, and auditable, human-in-the-loop AI, offering a compelling framework for empowering researchers in other complex academic and professional fields.
