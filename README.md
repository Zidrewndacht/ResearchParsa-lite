# ResearchParça-Lite

Minimal, generalized (not domain-specific) Lite version of ResearchParça. Also check the [full version repository](https://github.com/Zidrewndacht/bibtex-custom-parser).

Automatic classification/verification functionality is stripped out (as the classifier would require domain-specific tables, etc.), but frontend goodies are kept:

Autosaving PDF Annotator;
Primary vs Survey filtering;
Sortable table columns;
Searchable abstracts, keywords, authors, user comments;
Full backup/restore (original+annotated PDFs and DB with comments);
BibTeX imports, HTML/XLSX exports
(Some) Dynamic statistics;

In other words, this version is a glorified PDF annotator with some statistics charts. This was made mostly to allow generic usage of the autosaving annotator, but it was easier to strip ResearchParça functionality than build a new UI just for that.

