import os
import requests
from flask import Blueprint, jsonify, request
from src.server.services import repo_summary_service
from concurrent.futures import ThreadPoolExecutor
from prometheus_swarm.database import get_db
from src.server.services.repo_summary_service import logger

bp = Blueprint("task", __name__)
executor = ThreadPoolExecutor(max_workers=2)


def post_pr_url(agent_result, task_id, signature, round_number):
    try:
        result = agent_result.result()  # Get the result from the future
        logger.info(f"Result: {result}")
        result_data = result.get("result", {})
        logger.info(f"Result data: {result_data}")
        # Make a POST request with the result
        response = requests.post(
            f"http://host.docker.internal:30017/task/{task_id}/add-todo-pr",
            json={
                "prUrl": result_data.get("data", {}).get("pr_url"),
                "signature": signature,
                "roundNumber": round_number,
                "success": result.get("success", False),
                "message": result_data.get("error", ""),
            },
        )
        response.raise_for_status()  # Raise an error for bad responses
    except Exception as e:
        # Handle exceptions (e.g., log the error)
        logger.error(f"Failed to send result: {e}")
        logger.error(f"Exception type: {type(e)}")
        if hasattr(e, "__traceback__"):
            import traceback

            logger.error(f"Traceback: {''.join(traceback.format_tb(e.__traceback__))}")


@bp.post("/worker-task/<round_number>")
def start_task(round_number):
    logger = repo_summary_service.logger
    logger.info(f"Task started for round: {round_number}")

    data = request.get_json()
    task_id = data["task_id"]
    podcall_signature = data["podcall_signature"]
    repo_url = data["repo_url"]
    logger.info(f"Task data: {data}")
    required_fields = ["task_id", "round_number", "repo_url", "podcall_signature"]
    if any(data.get(field) is None for field in required_fields):
        return jsonify({"error": "Missing data"}), 401

    # Get db instance in the main thread where we have app context
    db = get_db()

    if os.getenv("TEST_MODE") == "true":
        result = repo_summary_service.handle_task_creation(
            task_id=task_id,
            round_number=int(round_number),
            repo_url=repo_url,
            db=db,  # Pass db instance
        )
        return jsonify(result)
    else:
        agent_result = executor.submit(
            repo_summary_service.handle_task_creation,
            task_id=task_id,
            round_number=round_number,
            repo_url=repo_url,
            db=db,  # Pass db instance
        )
        agent_result.add_done_callback(
            lambda future: post_pr_url(future, task_id, podcall_signature, round_number)
        )
        return jsonify({"status": "Task is being processed"}), 200


if __name__ == "__main__":
    from flask import Flask

    # Create a Flask app instance
    app = Flask(__name__)
    app.register_blueprint(bp)

    # Test data
    test_data = {
        "taskId": "fake",
        "round_number": "1",
        "repo_url": "https://github.com/koii-network/docs",
    }

    # Set up test context
    with app.test_client() as client:
        # Make a POST request to the endpoint
        response = client.post("/repo_summary/1", json=test_data)

        # Print the response
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.get_json()}")
