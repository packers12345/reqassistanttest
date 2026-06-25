import re
from typing import List, Dict


def parse_requirements(text: str) -> List[Dict]:
    """
    Extract numbered requirements from text.

    Handles a broad range of formats, e.g.:
      1. The system shall...
      1) The system shall...
      REQ-001: The system shall...
      REQ001: The system shall...
      FR.1: The system shall...
      FR-1: The system shall...
      SYS-REQ-001: The system shall...
      [1] The system shall...
      (1) The system shall...
      R1: The system shall...

    Multi-line requirements (continuation lines with no ID prefix) are joined.
    """
    requirements = []
    lines = text.split('\n')

    # Each pattern: group 1 = ID, group 2 = text
    patterns = [
        r'^\[(\d+)\]\s+(.+)$',                          # [1] text
        r'^\((\d+)\)\s+(.+)$',                          # (1) text
        r'^(\d+)\.\s+(.+)$',                            # 1. text
        r'^(\d+)\)\s+(.+)$',                            # 1) text
        r'^([A-Z]+-[A-Z]+-\d+):\s*(.+)$',              # SYS-REQ-001: text
        r'^([A-Z]+-\d+):\s*(.+)$',                     # REQ-001, FR-1: text
        r'^([A-Z]+\d+):\s*(.+)$',                      # REQ001, R1: text
        r'^([A-Z]+\.\d+):\s*(.+)$',                    # FR.1: text
        r'^([A-Z]+\.\d+\.\d+):\s*(.+)$',              # FR.1.1: text
        r'^([A-Z]+-[A-Z0-9]+(?:\.[A-Z0-9]+)*):\s*(.+)$',  # MR-C1.1, MR-C1: text
    ]

    current_req = None

    for line in lines:
        line = line.strip()
        if not line:
            if current_req:
                requirements.append(current_req)
                current_req = None
            continue

        matched = False
        for pattern in patterns:
            match = re.match(pattern, line, re.IGNORECASE)
            if match:
                if current_req:
                    requirements.append(current_req)
                req_id, req_text = match.groups()
                current_req = {
                    'id': req_id.strip(),
                    'text': req_text.strip()
                }
                matched = True
                break

        if not matched and current_req:
            # Continuation line — append to current requirement
            current_req['text'] += ' ' + line

    if current_req:
        requirements.append(current_req)

    return requirements


def validate_requirements(requirements: List[Dict]) -> Dict:
    """Validate parsed requirements."""
    if not requirements:
        return {
            'valid': False,
            'error': (
                'No requirements found. Supported formats include: '
                '"1. text", "REQ-001: text", "FR.1: text", "R1: text", etc.'
            )
        }

    ids = [r['id'] for r in requirements]
    if len(ids) != len(set(ids)):
        duplicates = [id for id in ids if ids.count(id) > 1]
        return {
            'valid': False,
            'error': f'Duplicate requirement IDs found: {", ".join(set(duplicates))}'
        }

    return {
        'valid': True,
        'count': len(requirements)
    }
