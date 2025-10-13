@echo off


rem D:\!staging\BibTeX-custom-parser\.venv\Scripts\python D:\!staging\BibTeX-custom-parser\automate_classification.py --mode on_topic_implementation

rem echo Re-classifying potential misclassifications (on-topic with empty featureset):
rem D:\!staging\BibTeX-custom-parser\.venv\Scripts\python D:\!staging\BibTeX-custom-parser\automate_classification.py --mode no_features

echo Classifying remaining (possibly new) papers:
D:\!staging\BibTeX-custom-parser\.venv\Scripts\python D:\!staging\BibTeX-custom-parser\automate_classification.py --mode remaining

echo Verifying (misclassified and remaining new) papers:
D:\!staging\BibTeX-custom-parser\.venv\Scripts\python D:\!staging\BibTeX-custom-parser\verify_classification.py --mode remaining
pause