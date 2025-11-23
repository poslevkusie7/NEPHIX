# main.py
import subprocess
import sys

def main():
    """Launch the Streamlit UI."""
    try:
        print("🚀 Starting Essay & Reading Assistant UI...")
        subprocess.run([sys.executable, "-m", "streamlit", "run", "ui_app.py"])
    except KeyboardInterrupt:
        print("\n🛑 Exiting gracefully.")
    except Exception as e:
        print(f"❌ Failed to start UI: {e}")

if __name__ == "__main__":
    main()