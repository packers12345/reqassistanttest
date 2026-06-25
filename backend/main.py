from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request, Header
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, List
import uuid
import os
from pathlib import Path
from dotenv import load_dotenv

from requirements_parser import parse_requirements, validate_requirements
from ai_analyzer import analyze_all_requirements
from feedback_storage import (
    save_analysis, save_feedback, load_analysis, load_feedback,
    save_set_analysis, load_set_analysis, save_docx, load_docx,
)
from document_generator import generate_feedback_document
from reviewer_manager import register_reviewer, get_reviewer, list_reviewers, delete_reviewer
from consensus_engine import (
    create_session_config, save_reviewer_feedback,
    load_reviewer_feedback, compute_resolution,
    apply_override, get_consensus_summary,
    _load_session_config
)
try:
    from knowledge_store import KnowledgeStore
    _KNOWLEDGE_STORE_AVAILABLE = True
except Exception:
    KnowledgeStore = None
    _KNOWLEDGE_STORE_AVAILABLE = False
try:
    from ontology_service import OntologyService
    from set_analyzer import SetAnalyzer
    from set_analysis_prompt import analyze_set
    _ONTOLOGY_AVAILABLE = True
except Exception:
    OntologyService = None
    SetAnalyzer = None
    analyze_set = None
    _ONTOLOGY_AVAILABLE = False

load_dotenv(dotenv_path=Path(__file__).parent / '.env')

# Lazy singletons
_ont_service = None
_set_analyzer = None

def _get_set_analyzer():
    global _set_analyzer
    if not _ONTOLOGY_AVAILABLE:
        return None
    if _set_analyzer is None:
        _set_analyzer = SetAnalyzer(_get_ontology_service())
    return _set_analyzer

def _get_ontology_service():
    global _ont_service
    if _ont_service is None:
        base = Path(__file__).parent / 'ontology'
        _ont_service = OntologyService(
            str(base / 'incose-req.ttl'),
            str(base / 'incose-req-rules.ttl'),
            str(base / 'incose-req.shapes.ttl'),
        )
    return _ont_service

app = FastAPI(title="INCOSE Requirements Analyzer API")

# CORS middleware for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).parent.parent
FRONTEND_DIST = BASE_DIR / 'frontend' / 'dist'
# Note: no uploads/outputs directories — all session data is kept in memory only
# (see feedback_storage.py). Nothing the user uploads or generates is written to disk.


# ===========================================================
# Original endpoints (backwards-compatible)
# ===========================================================

@app.get("/api")
def read_root():
    return {
        "message": "INCOSE Requirements Analyzer API",
        "version": "2.0.0",
        "features": ["multi-reviewer", "rag-learning"]
    }


@app.get("/api/config")
def get_config():
    """Expose active AI provider to the frontend (never exposes keys)."""
    from ai_analyzer import get_provider
    provider = get_provider()
    model_label = {
        "anthropic": "Claude (Anthropic)",
        "openai": "GPT-4o (OpenAI)",
        "ollama": f"Ollama / {os.getenv('OLLAMA_MODEL', 'llama3')}",
    }.get(provider, provider)
    # Report key status per provider so the frontend can show the green banner
    # for any provider that has a key in .env, regardless of which is active
    return {
        "provider": provider,
        "model_label": model_label,
        "has_key": bool(os.getenv('ANTHROPIC_API_KEY', '').strip()) if provider == 'anthropic' else bool(os.getenv('OPENAI_API_KEY', '').strip()),
        "keys": {
            "anthropic": bool(os.getenv('ANTHROPIC_API_KEY', '').strip()),
            "openai": bool(os.getenv('OPENAI_API_KEY', '').strip()),
        },
    }


@app.post("/api/upload")
async def upload_files(
    request: Request,
    requirements_file: UploadFile = File(...),
    context_file: Optional[UploadFile] = File(None),
):
    """Upload requirements and optional context files, start analysis."""
    # Provider and key come from the UI headers; fall back to .env values.
    api_key  = request.headers.get('X-API-Key', '').strip()
    provider = request.headers.get('X-AI-Provider', '').strip().lower() or os.getenv('AI_PROVIDER', 'anthropic')

    if not api_key:
        # Try .env fallback keys
        if provider == 'openai':
            api_key = os.getenv('OPENAI_API_KEY', '').strip()
        else:
            api_key = os.getenv('ANTHROPIC_API_KEY', '').strip()

    if not api_key:
        raise HTTPException(status_code=400, detail=f"No API key provided for provider '{provider}'.")

    # Inject into env so ai_analyzer picks them up (thread-safe for single worker)
    os.environ['AI_PROVIDER']     = provider
    os.environ['ANTHROPIC_API_KEY'] = api_key if provider == 'anthropic' else os.getenv('ANTHROPIC_API_KEY', '')
    os.environ['OPENAI_API_KEY']    = api_key if provider == 'openai'    else os.getenv('OPENAI_API_KEY', '')

    session_id = str(uuid.uuid4())[:8]

    # Read requirements file into memory (never written to disk)
    content = await requirements_file.read()

    # Read context file if provided (in memory only)
    context_text = ""
    if context_file:
        ctx_content = await context_file.read()
        context_text = ctx_content.decode('utf-8', errors='replace')

    # Parse requirements
    req_text = content.decode('utf-8', errors='replace')
    requirements = parse_requirements(req_text)
    validation = validate_requirements(requirements)

    if not validation['valid']:
        raise HTTPException(status_code=400, detail=validation['error'])

    # Run AI analysis (now RAG-enhanced)
    try:
        analysis = analyze_all_requirements(
            requirements,
            context_text,
            session_id=session_id,
        )

        save_analysis(session_id, analysis)

        return {
            "session_id": session_id,
            "status": "completed",
            "message": "Analysis completed successfully",
            "requirements_count": len(requirements),
            "violations_count": sum(
                sum(1 for ev in req.get('criteria_evaluations', []) if not ev.get('satisfied', True))
                for req in analysis['requirements']
            ),
            "rag_enhanced": analysis.get('rag_enhanced', False)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


@app.get("/api/analysis/{session_id}")
def get_analysis(session_id: str):
    """Retrieve analysis results for a session."""
    try:
        return load_analysis(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Analysis not found")


@app.post("/api/feedback/{session_id}")
async def submit_feedback(session_id: str, feedback: dict):
    """Submit user feedback for all requirements (single-reviewer / legacy mode)."""
    try:
        analysis = load_analysis(session_id)
        save_feedback(session_id, feedback)
        docx_bytes = generate_feedback_document(session_id, analysis, feedback)
        save_docx(session_id, docx_bytes)

        # Auto-ingest into RAG knowledge base
        try:
            ks = KnowledgeStore()
            context = analysis.get('context', '')
            count = ks.ingest_feedback(session_id, feedback, analysis, context)
            print(f"RAG: Ingested {count} knowledge units from session {session_id}")
        except Exception as e:
            print(f"RAG ingestion skipped: {e}")

        return {
            "session_id": session_id,
            "status": "feedback_saved",
            "message": "Feedback stored and document generated successfully"
        }
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Analysis not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process feedback: {str(e)}")


@app.get("/api/feedback/{session_id}")
def get_feedback(session_id: str):
    """Retrieve stored feedback for a session."""
    try:
        return load_feedback(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Feedback not found")


@app.get("/api/download/docx/{session_id}")
def download_docx(session_id: str):
    """Download final DOCX document (served from memory)."""
    data = load_docx(session_id)

    if data is None:
        raise HTTPException(status_code=404, detail="Document not found. Submit feedback first.")

    return Response(
        content=data,
        media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        headers={
            'Content-Disposition': f'attachment; filename="incose_analysis_{session_id}.docx"'
        },
    )


@app.get("/api/download/json/{session_id}")
def download_json(session_id: str):
    """Download feedback JSON (served from memory)."""
    try:
        feedback = load_feedback(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Feedback not found. Submit feedback first.")

    return JSONResponse(
        content=feedback,
        headers={
            'Content-Disposition': f'attachment; filename="feedback_{session_id}.json"'
        },
    )


# ===========================================================
# Multi-Reviewer Endpoints
# ===========================================================

@app.post("/api/reviewers")
async def create_reviewer(body: dict):
    """Register a new reviewer with a role (lead, senior, junior)."""
    name = body.get('name', '').strip()
    role = body.get('role', '').strip()

    if not name:
        raise HTTPException(status_code=400, detail="Reviewer name is required")
    if not role:
        raise HTTPException(status_code=400, detail="Role is required (lead, senior, junior)")

    try:
        reviewer = register_reviewer(name, role)
        return reviewer
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/reviewers")
def get_reviewers():
    """List all registered reviewers."""
    return {"reviewers": list_reviewers()}


@app.post("/api/sessions/{session_id}/invite")
async def invite_reviewers(session_id: str, body: dict):
    """Assign reviewers to a session for multi-reviewer mode."""
    try:
        load_analysis(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found. Upload requirements first.")

    reviewer_ids = body.get('reviewer_ids', [])
    if not reviewer_ids or len(reviewer_ids) < 2:
        raise HTTPException(status_code=400, detail="At least 2 reviewers required for multi-reviewer mode")

    # Validate all reviewer IDs exist
    for rid in reviewer_ids:
        if not get_reviewer(rid):
            raise HTTPException(status_code=404, detail=f"Reviewer {rid} not found")

    strategy = body.get('strategy', 'weighted_vote')
    config = create_session_config(session_id, reviewer_ids, strategy)

    # Generate review links
    review_links = [
        {"reviewer_id": rid, "url": f"/review/{session_id}?reviewer={rid}"}
        for rid in reviewer_ids
    ]

    return {
        "session_id": session_id,
        "status": "reviewing",
        "review_links": review_links,
        "config": config
    }


@app.get("/api/sessions/{session_id}/config")
def get_session_config(session_id: str):
    """Get session configuration (reviewer assignments, status)."""
    try:
        return _load_session_config(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Session config not found (single-reviewer session?)")


@app.post("/api/feedback/{session_id}/{reviewer_id}")
async def submit_reviewer_feedback(session_id: str, reviewer_id: str, feedback: dict):
    """Submit feedback from a specific reviewer."""
    reviewer = get_reviewer(reviewer_id)
    if not reviewer:
        raise HTTPException(status_code=404, detail=f"Reviewer {reviewer_id} not found")

    try:
        load_analysis(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Analysis not found")

    try:
        save_reviewer_feedback(session_id, reviewer_id, feedback)

        return {
            "session_id": session_id,
            "reviewer_id": reviewer_id,
            "status": "feedback_saved",
            "message": f"Feedback from {reviewer['name']} saved successfully"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save feedback: {str(e)}")


@app.get("/api/feedback/{session_id}/{reviewer_id}")
def get_reviewer_feedback(session_id: str, reviewer_id: str):
    """Get a specific reviewer's feedback."""
    try:
        return load_reviewer_feedback(session_id, reviewer_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Feedback not found for this reviewer")


@app.get("/api/consensus/{session_id}")
def get_consensus(session_id: str):
    """Get consensus summary showing agreement/conflict across all reviewers."""
    try:
        return get_consensus_summary(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Session config not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/consensus/{session_id}/resolve")
async def resolve_consensus(session_id: str):
    """Trigger weighted-vote resolution for all violations."""
    try:
        resolved = compute_resolution(session_id)

        # Generate document from resolved feedback
        analysis = load_analysis(session_id)
        # Convert resolved format to standard feedback format for doc generation
        doc_feedback = {
            'requirement_feedback': []
        }
        for req in resolved['requirement_feedback']:
            doc_req = {
                'req_id': req['req_id'],
                'original_text': req['original_text'],
                'final_text': req['final_text'],
                'overall_notes': req.get('overall_notes', ''),
                'violation_feedback': []
            }
            for viol in req['violation_feedback']:
                doc_req['violation_feedback'].append({
                    'violation_id': viol['violation_id'],
                    'rule_id': viol['rule_id'],
                    'user_action': viol['resolved_action'],
                    'ai_suggestion': viol.get('ai_suggestion', ''),
                    'user_text': viol['resolved_text'],
                    'notes': f"Resolved by {viol['resolution_method']} (confidence: {viol['confidence']})"
                })
            doc_feedback['requirement_feedback'].append(doc_req)

        docx_bytes = generate_feedback_document(session_id, analysis, doc_feedback)
        save_docx(session_id, docx_bytes)

        # Auto-ingest resolved feedback into RAG
        try:
            ks = KnowledgeStore()
            context = analysis.get('context', '')
            count = ks.ingest_feedback(session_id, resolved, analysis, context)
            print(f"RAG: Ingested {count} knowledge units from resolved session {session_id}")
        except Exception as e:
            print(f"RAG ingestion skipped: {e}")

        return resolved
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Resolution failed: {str(e)}")


@app.post("/api/consensus/{session_id}/override")
async def override_violation(session_id: str, body: dict):
    """Lead reviewer manually overrides a conflict resolution."""
    violation_id = body.get('violation_id', '')
    action = body.get('action', '')
    text = body.get('text', '')
    reviewer_id = body.get('reviewer_id', '')

    if not all([violation_id, action, reviewer_id]):
        raise HTTPException(status_code=400, detail="violation_id, action, and reviewer_id are required")

    reviewer = get_reviewer(reviewer_id)
    if not reviewer:
        raise HTTPException(status_code=404, detail="Reviewer not found")
    if reviewer['role'] != 'lead':
        raise HTTPException(status_code=403, detail="Only lead reviewers can override resolutions")

    try:
        resolved = apply_override(session_id, violation_id, action, text, reviewer_id)
        return resolved
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="No resolved feedback found. Run resolution first.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ===========================================================
# Ontology-Based Analysis Endpoints
# ===========================================================

@app.get("/api/analysis/{session_id}/coverage")
def get_coverage(session_id: str):
    """Compute characteristic and rule coverage from ontology-backed analysis."""
    try:
        analysis = load_analysis(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Analysis not found")
    svc = _get_ontology_service()
    graph = svc.mint_assessment_rdf(session_id, analysis)
    return svc.compute_coverage(graph)


@app.get("/api/analysis/{session_id}/quality-profile")
def get_quality_profile(session_id: str):
    """Compute per-characteristic quality profile from ontology-backed analysis."""
    try:
        analysis = load_analysis(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Analysis not found")
    svc = _get_ontology_service()
    graph = svc.mint_assessment_rdf(session_id, analysis)
    return svc.compute_quality_profile(graph)


@app.get("/api/analysis/{session_id}/validation")
def get_validation(session_id: str):
    """Validate minted assessment RDF against SHACL shapes."""
    try:
        analysis = load_analysis(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Analysis not found")
    svc = _get_ontology_service()
    graph = svc.mint_assessment_rdf(session_id, analysis)
    conforms, violations = svc.validate_assessment(graph)
    return {
        "conforms": conforms,
        "violation_count": len(violations),
        "violations": violations,
    }


# ===========================================================
# RAG Knowledge Base Endpoints
# ===========================================================

@app.get("/api/knowledge/stats")
def knowledge_stats():
    """Get knowledge base statistics."""
    try:
        ks = KnowledgeStore()
        return ks.get_knowledge_stats()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/knowledge/calibration")
def knowledge_calibration():
    """Get current rule calibration data (acceptance rates per rule)."""
    try:
        ks = KnowledgeStore()
        return ks.get_rule_calibration()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/knowledge/reset")
def knowledge_reset():
    """Clear the entire knowledge base (admin action)."""
    try:
        ks = KnowledgeStore()
        ks.reset()
        return {"status": "reset", "message": "Knowledge base cleared successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ===========================================================
# Set-Level Analysis Endpoints
# ===========================================================

@app.post("/api/set-analysis/{session_id}")
async def run_set_analysis(session_id: str, x_api_key: str = Header(None)):
    """Run set-level analysis on an existing session's requirements."""
    try:
        analysis = load_analysis(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Analysis not found")

    requirements = analysis.get('requirements', [])
    if not requirements:
        raise HTTPException(status_code=400, detail="No requirements found in analysis")

    analyzer = _get_set_analyzer()
    programmatic_report = analyzer.generate_set_report(requirements, analysis)

    combined = dict(programmatic_report)

    if x_api_key:
        context = analysis.get('context', '')
        glossary = programmatic_report.get('glossary', {})
        claude_analysis = analyze_set(
            requirements, context, glossary, programmatic_report, x_api_key
        )
        combined['semantic_analysis'] = claude_analysis

    save_set_analysis(session_id, combined)
    return combined


@app.get("/api/set-analysis/{session_id}")
async def get_set_analysis(session_id: str):
    """Return stored set-level analysis results."""
    result = load_set_analysis(session_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Set analysis not found. Run POST /api/set-analysis/{session_id} first.")
    return result


@app.get("/api/set-analysis/{session_id}/glossary")
async def get_glossary(session_id: str):
    """Return just the glossary from stored set analysis."""
    result = load_set_analysis(session_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Set analysis not found")
    return result.get('glossary', {})


@app.get("/api/set-analysis/{session_id}/conflicts")
async def get_conflicts(session_id: str):
    """Return just the conflicts from stored set analysis."""
    result = load_set_analysis(session_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Set analysis not found")
    return result.get('conflicts', [])


# ===========================================================
# Static file serving
# ===========================================================

# Serve the built frontend (single-page app) in production.
# Hashed assets are served from /assets; every other non-API path falls back to
# index.html so client-side routes (e.g. /review/<id>, /download/<id>) load even
# on a hard refresh or when a link is opened directly.
if FRONTEND_DIST.exists():
    _ASSETS_DIR = FRONTEND_DIST / "assets"
    if _ASSETS_DIR.exists():
        app.mount("/assets", StaticFiles(directory=str(_ASSETS_DIR)), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # Never hijack API routes — let them 404 as JSON if unmatched above.
        if full_path.startswith("api"):
            raise HTTPException(status_code=404, detail="Not found")
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(FRONTEND_DIST / "index.html"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
