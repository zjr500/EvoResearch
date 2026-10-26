import argparse


def main():
    parser = argparse.ArgumentParser(description="EvoResearch phase 5 service")
    parser.add_argument("command", choices=["serve", "worker", "projection-worker", "sync-tracking", "sync-knowledge"])
    parser.add_argument("--port", type=int, default=8091)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--replay", action="store_true")
    args = parser.parse_args()
    if args.command == "sync-knowledge":
        import json
        from autoresearch.config import Settings
        from .adapter import AutoResearchAdapter
        from .knowledge import dispatch
        print(json.dumps(dispatch(AutoResearchAdapter(Settings.from_env()).store,force=args.replay)))
    elif args.command == "sync-tracking":
        import json
        from autoresearch.config import Settings
        from .adapter import AutoResearchAdapter
        from .tracking import dispatch
        print(json.dumps(dispatch(AutoResearchAdapter(Settings.from_env()).store, replay=args.replay)))
    elif args.command == "projection-worker":
        from .projection_worker import main as worker
        worker(once=args.once)
    elif args.command == "worker":
        from .worker import main as worker
        worker(once=args.once)
    else:
        import uvicorn
        from .api import create_app
        uvicorn.run(create_app(), host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
