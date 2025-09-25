A Beginner's Guide to ResearchParça's Technology Stack

Introduction: Understanding the Engine

Welcome to a tour of the core technologies that power the ResearchParça tool. At its heart, ResearchParça turns a raw pile of academic PDFs into an interactive, filterable, ‘spreadsheet-meets-dashboard’. It's what's known as a "full-stack" web application, meaning it includes all the necessary parts to run independently—from the user interface you see in the browser to the data storage working behind the scenes. This guide will demystify its main building blocks: the frontend, the backend, the database, and the local AI that makes the tool so intelligent.

The Big Picture: How the Pieces Fit Together

To understand how a modern web application works, it's helpful to use an analogy. Imagine the application is a restaurant. There are three main areas: the dining room where customers interact, the kitchen where the work gets done, and the pantry where ingredients are stored. ResearchParça is built on this same three-part structure.

Component	Analogy (A Restaurant)	Role in ResearchParça
Frontend	The Dining Area	The interactive user interface you see and use in your web browser. This includes the data table, search bar, filters, and charts.
Backend	The Kitchen	The hidden "engine room" that receives your requests (like a search), processes them, and prepares the data to be shown.
Database	The Pantry / Storage	The organized library where all the information about every academic paper is stored securely and can be retrieved instantly.

Now, let's take a closer look at the specific technologies that make up each of these components.

The Core Components Explained

1. The Backend: Flask

What it is: Flask is a tool (a "framework") written in the Python programming language that is used to build the server-side of a web application. Think of it as the application's engine room, responsible for handling all the logic and operations that happen behind the scenes.

Its role in ResearchParça: In this tool, Flask's primary job is to act as the local web server. When you run the python browse_db.py command, you are starting the Flask server on your own computer. It listens for requests from your browser, such as when you search for a paper or apply a filter. Flask then retrieves the correct paper information from the database and handles saving any edits you make to your paper classifications. It does this by providing a RESTful API, which enables a clean separation between the frontend and backend operations.

2. The Frontend: Vanilla JavaScript

What it is: "Vanilla JavaScript" simply refers to the pure, standard JavaScript language, used without any large, external frameworks. This "back to basics" approach was chosen for ResearchParça because having no framework re-renders keeps the browser’s main thread free for smooth scrolling, making the user interface as fast and responsive as possible.

Its role in ResearchParça: Vanilla JavaScript is what brings the user interface to life, making it dynamic and interactive. Its most important functions in the tool include:

* Instantaneous Filtering: When you use the client-side toggle filters (like "Only Surveys" or "Hide X-Ray"), JavaScript instantly hides or shows the relevant rows in the browser without needing to contact the server.
* Sortable Columns: Clicking on any column header to sort the data is a feature handled entirely by JavaScript, re-ordering the table view in a fraction of a second.
* Expanding Detail Views: When you click "Show" on a row, JavaScript fetches and displays the full abstract and metadata for that paper without reloading the entire page, creating a smooth user experience.

3. The Database: SQLite

What it is: SQLite is a lightweight, self-contained database that stores all of its data in a single file on your computer (for example, my_db.sqlite). Unlike larger database systems that require a separate server process, SQLite is simple, portable, and extremely easy to set up, making it perfect for a local application like ResearchParça.

Its role in ResearchParça: The SQLite database file acts as the complete, organized library for all of your academic papers. Its key benefit for the user is incredible speed. Thanks to powerful built-in capabilities like Full-Text Search (FTS5), the tool updates in 200 ms for 15,000 records on a laptop, and FTS5 gives millisecond search even when the corpus grows past 50,000 papers.

4. The "AI Intern": Local LLM

What it is: A "Local LLM" is a Large Language Model that runs entirely on the researcher's own computer hardware, rather than in the cloud. ResearchParça uses the llama.cpp engine to run a specific model, Qwen3-30B-A3B-Thinking-2507. This local approach ensures complete data privacy (your research never leaves your machine) and allows the tool to function perfectly offline.

Its role in ResearchParça: The LLM acts as an automated research assistant, performing a crucial two-stage analysis on each paper:

1. Classifier: First, the LLM reads a paper's abstract, title, and other metadata. Based on this information, it automatically categorizes the paper across multiple dimensions (e.g., identifying defect types like 'solder void' or technical approaches like 'CNN Detector').
2. Verifier: In a second pass, the LLM reviews its own classification to check for accuracy and consistency. This self-verification step helps to ensure high-quality, reliable results.

For full transparency, the complete "chain-of-thought" reasoning from both the classifier and the verifier is saved and can be viewed for any paper.

Let's see how these parts work together in a real-world example.

Putting It All Together: A User's Journey

Here is a step-by-step walkthrough of what happens when you search for a paper in ResearchParça, showing how each technology plays its part.

1. You run the application: You execute the python browse_db.py command. The Flask backend starts a local web server on your machine.
2. You open the tool: Your web browser loads the user interface, which is built with HTML/CSS and brought to life by vanilla JavaScript.
3. You type in the search bar: The vanilla JavaScript code captures your search term and sends a request to the backend.
4. The backend gets to work: The Flask server receives the request and constructs a query to find matching papers in the SQLite database file.
5. Data is returned: The SQLite database uses its powerful Full-Text Search feature to find the relevant papers in milliseconds and sends the information back through Flask to your browser.
6. The view updates instantly: Vanilla JavaScript receives the new data and redraws the table on your screen to show only the filtered results, all without a full page reload.

Conclusion

By combining these powerful yet focused technologies, ResearchParça becomes more than just a tool—it acts as an AI-augmented research co-pilot. It transforms a simple collection of papers into a deeply structured, interrogable, and shareable knowledge base, designed to make your research more efficient and insightful.
