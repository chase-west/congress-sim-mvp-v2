from typing import Tuple
import io
from pypdf import PdfReader
from bs4 import BeautifulSoup

def parse_bill_file_content(filename: str, content: bytes) -> Tuple[str, str]:
    """
    Parses uploaded file content and returns (title_guess, text_content).
    Methods:
      - PDF: Extract text page by page.
      - XML/HTML: Use BS4 to strip tags.
      - TXT: Decode utf-8.
    """
    fname = filename.lower()
    text = ""
    
    if fname.endswith(".pdf"):
        try:
            reader = PdfReader(io.BytesIO(content))
            parts = []
            for page in reader.pages:
                extracted = page.extract_text()
                if extracted:
                    parts.append(extracted)
            text = "\n\n".join(parts)
        except Exception as e:
            text = f"Error reading PDF: {str(e)}"
            
    elif fname.endswith(".html") or fname.endswith(".htm") or fname.endswith(".xml"):
        try:
            # XML in Congress.gov often resembles HTML or has specific tags. 
            # BS4 'lxml' or 'xml' parser is good. We'll try generic html.parser or lxml if available.
            # Using 'html.parser' to avoid lxml dependency if not installed (though bs4 usually needs it for xml).
            # We'll stick to 'html.parser' for safety or just 'lxml-xml' if we strictly want xml, 
            # but usually 'features="xml"' provided by bs4 works.
            
            soup = BeautifulSoup(content, features="html.parser")
            
            # Remove scripts and styles
            for script in soup(["script", "style"]):
                script.decompose()
                
            text = soup.get_text(separator="\n")
        except Exception as e:
            text = f"Error parsing HTML/XML: {str(e)}"
            
    else:
        # Assume text/plain
        try:
            text = content.decode("utf-8", errors="replace")
        except Exception as e:
            text = f"Error decoding text: {str(e)}"

    # Basic cleanup
    text = text.strip()
    
    # Guess title from first few lines if possible, or just filename
    lines = [l.strip() for l in text.split('\n') if l.strip()][:5]
    title_guess = lines[0] if lines else filename
    
    # Heuristic: If first line is "118th CONGRESS", maybe 2nd or 3rd line is title?
    # Keeping it simple for MVP: just return the filename as title guess, user can edit.
    # Actually, returning the first non-empty line as a 'suggested' title is often nice.
    possible_title = filename
    for l in lines:
        if len(l) > 5 and "congress" not in l.lower() and "session" not in l.lower():
            possible_title = l
            break
            
    return possible_title, text
