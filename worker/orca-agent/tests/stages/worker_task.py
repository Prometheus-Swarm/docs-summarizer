"""Stage for executing worker tasks."""

import requests


def prepare(runner, worker):
    """Prepare data for worker task"""
    round_state = runner.state["rounds"].get(str(runner.current_round), {})
    if not round_state.get("repo_url"):
        print(f"✓ No repo url found for {worker.name} - continuing")
        return
    return {
        "taskId": runner.config.task_id,
        "round_number": str(runner.current_round),
        "repo_url": round_state["repo_url"],
    }


def execute(runner, worker, data):
    """Execute worker task step"""
    if not data:
        return {"success": True, "message": "No repo url found"}
    url = f"{worker.url}/worker-task/{runner.current_round}"
    response = requests.post(url, json=data)
    result = response.json()

    # Handle 409 gracefully - no eligible todos is an expected case
    if response.status_code == 409:
        print(
            f"✓ {result.get('message', 'No eligible todos')} for {worker.name} - continuing"
        )
        return {"success": True, "message": result.get("message")}

    if result.get("success") and "pr_url" in result["result"]["data"]:
        round_key = str(runner.current_round)
        round_state = runner.state["rounds"].setdefault(round_key, {})

        # Initialize pr_urls if not exists
        if "pr_urls" not in round_state:
            round_state["pr_urls"] = {}
        round_state["pr_urls"][worker.name] = result["result"]["data"]["pr_url"]

    return result
