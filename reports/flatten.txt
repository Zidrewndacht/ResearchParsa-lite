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