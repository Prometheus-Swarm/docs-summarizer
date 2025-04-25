"""Stage for executing worker tasks."""

import requests


def prepare(runner, worker, role: str):
    """Prepare data for worker task"""

    return {
        "taskId": runner.config.task_id,
        "round": runner.current_round,
    }


def execute(runner, worker, data):
    """Execute worker task step"""
    url = f"{runner.config.middle_server_url}/summarizer/worker/update-audit-result"
    response = requests.post(
        url,
        json=data,
    )
    response.raise_for_status()

    # Return a formatted response regardless of type
    return {"success": True, "message": response.text}
