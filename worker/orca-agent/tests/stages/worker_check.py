"""Stage for executing worker tasks."""

import requests


def prepare(runner, worker):
    """Prepare data for worker task"""
    # Create fetch-todo payload for stakingSignature and publicSignature
    round_state = runner.state["rounds"].get(str(runner.current_round), {})
    if not round_state.get("pr_urls"):
        print(f"✓ No PR URLs found for {worker.name} - continuing")
        return
    return {
        "stakingKey": worker.staking_public_key,
        "roundNumber": runner.current_round,
        "githubUsername": worker.env.get("GITHUB_USERNAME"),
        "prUrl": round_state.get("pr_urls", {}).get(worker.name),
    }


def execute(runner, worker, data):
    """Execute worker task step"""
    if not data:
        return {"success": True, "message": "No PR URL found"}
    url = f"{runner.config.middle_server_url}/summarizer/worker/check-todo"
    response = requests.post(
        url,
        json=data,
    )
    result = response.json()

    # Handle 409 gracefully - no eligible todos is an expected case
    if response.status_code == 409:
        print(
            f"✓ {result.get('message', 'No eligible todos')} for {worker.name} - continuing"
        )
        return {"success": True, "message": result.get("message")}
    else:
        response.raise_for_status()

    return result
