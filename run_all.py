import subprocess
import sys
import time
import os
import signal
from pathlib import Path

def start_services():
    print("--- Inizializzazione Italiacrit Continuous Service ---")
    
    # Percorsi
    base_dir = Path(__file__).parent
    scraper_path = base_dir / "scraper" / "fci_complete_scraper.py"
    log_path = base_dir / "data" / "service.log"
    
    # Assicurati che la cartella data esista
    (base_dir / "data").mkdir(exist_ok=True)
    
    print(f"--- Log salvati in {log_path} ---")
    
    with open(log_path, "a", encoding="utf-8") as log_file:
        # 1. Avvio Scraper in modalità Loop (ogni 15 minuti)
        print("--- Avvio Scraper Daemon (Loop: 15m) ---")
        scraper_proc = subprocess.Popen(
            [sys.executable, str(scraper_path), "--loop", "--interval", "15"],
            cwd=str(base_dir),
            stdout=log_file,
            stderr=log_file,
            text=True
        )
        
        # 2. Avvio Web Server locale su porta 8000
        print("--- Avvio Web Server su http://localhost:8000 ---")
        server_proc = subprocess.Popen(
            [sys.executable, "api_server.py"],
            cwd=str(base_dir),
            stdout=log_file,
            stderr=log_file,
            text=True
        )
        
        print("\n[OK] Sistema ATTIVO!")
        print("Il programma sta girando in background. Se aggiorni la pagina vedrai i risultati.")
        
        try:
            while True:
                # Controlla se i processi sono ancora vivi
                if scraper_proc.poll() is not None:
                    print("Scraper interrotto, riavvio...")
                    scraper_proc = subprocess.Popen(
                        [sys.executable, str(scraper_path), "--loop", "--interval", "15"], 
                        cwd=str(base_dir),
                        stdout=log_file,
                        stderr=log_file,
                        text=True
                    )
                
                if server_proc.poll() is not None:
                    print("Server interrotto, riavvio...")
                    server_proc = subprocess.Popen(
                        [sys.executable, "api_server.py"], 
                        cwd=str(base_dir),
                        stdout=log_file,
                        stderr=log_file,
                        text=True
                    )
                    
                time.sleep(10)
        except KeyboardInterrupt:
            print("\nSpegnimento in corso...")
            scraper_proc.terminate()
            server_proc.terminate()
            print("Sistema spento correttamente.")

if __name__ == "__main__":
    start_services()
