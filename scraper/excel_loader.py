import pandas as pd
import re
import unicodedata
from pathlib import Path

def slug(s):
    if not s: return "SCONOSCIUTO"
    s = unicodedata.normalize("NFD", str(s).lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9]", " ", s)
    return re.sub(r"\s+", "_", s).strip("_").upper() or "SCONOSCIUTO"

def load_calendar_from_excel(filepath):
    if not Path(filepath).exists():
        return []
    
    try:
        df = pd.read_excel(filepath)
        calendar = []
        for _, row in df.iterrows():
            nome = str(row.get("Nome Gara", "")).strip()
            if not nome or nome == "nan":
                continue
            
            data_raw = str(row.get("Data (GG-MM-YYYY)", "")).strip()
            # Convert DD-MM-YYYY to YYYY-MM-DD
            data_iso = ""
            if len(data_raw) >= 10:
                parts = data_raw.split("-")
                if len(parts) == 3:
                    if len(parts[0]) == 4: # Already YYYY-MM-DD
                        data_iso = data_raw
                    else:
                        data_iso = f"{parts[2]}-{parts[1]}-{parts[0]}"
            
            if not data_iso:
                continue

            tipo_raw = str(row.get("Categoria (Regionale, Nazionale, ecc)", "regionale")).lower()
            if "internazionale" in tipo_raw:
                tipo = "internazionale"
                molt = 3
            elif "nazionale" in tipo_raw:
                tipo = "nazionale"
                molt = 2
            else:
                tipo = "regionale"
                molt = 1
                
            is_cr = "campionato regionale" in nome.lower()
            is_ci = "campionato italiano" in nome.lower()
            
            regione = str(row.get("Regione", "")).strip()
            if regione == "nan": regione = ""
            
            gara_id = f"{slug(nome)}_{data_iso}"
            
            calendar.append({
                "id": gara_id,
                "nome": nome,
                "data": data_iso,
                "tipo": tipo,
                "moltiplicatore": molt,
                "campionato_regionale": is_cr,
                "campionato_italiano": is_ci,
                "regione": regione
            })
        return calendar
    except Exception as e:
        print(f"Error loading excel: {e}")
        return []
