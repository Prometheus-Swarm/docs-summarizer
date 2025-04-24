"""Stage for executing worker tasks."""

import requests


def prepare(runner, worker):
    """Prepare data for worker task"""

    return {
        "taskId": runner.config.task_id,
        "round_number": str(runner.current_round),
        "repo_url": runner.state["repo_url"],
    }


def execute(runner, worker, data):
    """Execute worker task step"""
    if not runner.state["repo_url"]:
        print(f"✓ No repo url found for {worker.name} - continuing")
        return {"success": True, "message": "No repo url found"}

    url = f"{worker.url}/worker-task/{data['roundNumber']}"
    response = requests.post(url, json=data)
    result = response.json()

    # Handle 409 gracefully - no eligible todos is an expected case
    if response.status_code in [401, 409]:
        print(
            f"✓ {result.get('message', 'No eligible todos')} for {worker.name} - continuing"
        )
        return {"success": True, "message": result.get("message")}

    if result.get("success") and "pr_url" in result:
        round_key = str(runner.current_round)
        round_state = runner.state["rounds"].setdefault(round_key, {})

        # Initialize pr_urls if not exists
        if "pr_urls" not in round_state:
            round_state["pr_urls"] = {}
        round_state["pr_urls"][worker.name] = result["pr_url"]

    return result
