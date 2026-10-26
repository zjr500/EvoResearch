import argparse
import os


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    server = sub.add_parser("serve")
    server.add_argument("--host", default="127.0.0.1")
    server.add_argument("--port", type=int, default=8765)
    worker = sub.add_parser("worker")
    worker.add_argument("--once", action="store_true")
    plan = sub.add_parser("plan", help="生成并检查本地 MVP 研究计划，不启动训练")
    plan.add_argument("--goal", required=True)
    plan.add_argument("--out", required=True)
    plan.add_argument("--home", default=os.getenv("AUTORESEARCH_HOME", "var"))
    plan.add_argument("--runner", choices=["docker", "local_trusted"], default=os.getenv("AUTORESEARCH_RUNNER", "docker"))
    plan.add_argument("--provider", choices=["openai_compatible", "feedback_demo"], default=os.getenv("AUTORESEARCH_PROVIDER", "openai_compatible"))
    from .templates import TEMPLATE
    for name, default in TEMPLATE["defaults"].items():
        plan.add_argument("--" + name.replace("_", "-"), type=int, default=default)
    run = sub.add_parser("run", help="确认指定计划版本并运行 MVP")
    run.add_argument("--plan", required=True)
    run.add_argument("--confirm", required=True)
    run.add_argument("--confirmer", default="", help="确认人；留空则确认记录保持待审核")
    run.add_argument("--opinion", default="", help="确认意见；留空则确认记录保持待审核")
    run.add_argument("--home", default=os.getenv("AUTORESEARCH_HOME", "var"))
    for command in ("status", "stop", "resume", "export"):
        item = sub.add_parser(command)
        item.add_argument("--run-id", required=True)
        item.add_argument("--home", default=os.getenv("AUTORESEARCH_HOME", "var"))
        if command == "resume":
            item.add_argument("--confirm", required=True)
        if command == "export":
            item.add_argument("--out", required=True)
    args = parser.parse_args()
    if args.command == "serve":
        import uvicorn
        from .api import create_app
        app = create_app()
        if app.state.settings.demo_auth and not app.state.settings.team_auth and args.host not in {"127.0.0.1", "::1", "localhost"}:
            parser.error("Demo authentication may only bind to loopback")
        uvicorn.run(app, host=args.host, port=args.port)
    elif args.command == "worker":
        from .worker import main as worker_main
        worker_main(args.once)
    else:
        from .mvp import main as mvp_main
        raise SystemExit(mvp_main(args))


if __name__ == "__main__":
    main()
