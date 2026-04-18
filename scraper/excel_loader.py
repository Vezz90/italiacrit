import pandas as pd
import re
import os
from pathlib import Path
from datetime import datetime
import unicodedata

def normalize_str(s):
    if not isinstance(s, str): return str(s)
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.lower()
    s = re.sub(r"[^\w\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()

def slugify(s):
    s = normalize_str(s)
    return re.sub(r"\s+", "_", s).upper()

def load_calendar_from_excel(file_path):
    print(f"      → Caricamento calendario da {os.path.basename(file_path)}...")
    try:
        df = pd.read_excel(file_path)
        
        # Mapping flessibile delle colonne
        col_map = {
            "nome": ["Nome Gara", "Gara", "nome", "Nome"],
            "data": ["Data", "data", "Data (GG-MM-YYYY)"],
            "tipo": ["Tipo", "tipo", "Categoria (Regionale, Nazionale, ecc)", "Classe"],
            "genere": ["Genere", "Uomini/Donne", "Sesso"],
            "categoria": ["Categoria", "cat"],
            "reginale": ["Campionato Regionale?", "Campionato Regionale", "CR"],
            "italiano": ["Campionato Italiano?", "Campionato Italiano", "CI"]
        }

        def find_col(key):
            for c in df.columns:
                if c in col_map[key]: return c
            return None

        c_nome = find_col("nome")
        c_data = find_col("data")
        c_tipo = find_col("tipo")
        c_gen = find_col("genere")
        c_cat = find_col("categoria")
        c_cr = find_col("reginale")
        c_ci = find_col("italiano")

        calendar = []
        for _, row in df.iterrows():
            nome = str(row.get(c_nome, "")).strip()
            if not nome or nome == "nan": continue
            
            # Gestione data
            raw_data = row.get(c_data)
            date_iso = ""
            if isinstance(raw_data, datetime):
                date_iso = raw_data.strftime("%Y-%m-%d")
            else:
                # Prova a parseare stringa
                d_str = str(raw_data).strip()
                for fmt in ["%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y"]:
                    try:
                        date_iso = datetime.strptime(d_str, fmt).strftime("%Y-%m-%d")
                        break
                    except: continue
            
            if not date_iso: continue

            # Mapping valori
            tipo_raw = str(row.get(c_tipo, "regionale")).lower()
            tipo = "regionale"
            if "inter" in tipo_raw: tipo = "internazionale"
            elif "naz" in tipo_raw: tipo = "nazionale"

            gen_raw = str(row.get(c_gen, "M")).upper()
            genere = "F" if "F" in gen_raw or "DON" in gen_raw else "M"
            
            cat = str(row.get(c_cat, "Elite-Under23")).strip()
            
            is_cr = str(row.get(c_cr, "")).lower() in ["si", "sì", "1", "true", "x"]
            is_ci = str(row.get(c_ci, "")).lower() in ["si", "sì", "1", "true", "x"]

            gara_id = f"{slugify(nome)}_{date_iso}"

            calendar.append({
                "id": gara_id,
                "nome": nome,
                "data": date_iso,
                "mese": int(date_iso.split("-")[1]),
                "anno": int(date_iso.split("-")[0]),
                "categoria": cat,
                "genere": genere,
                "tipo": tipo,
                "campionato_regionale": is_cr,
                "campionato_italiano": is_ci,
                "url": None
            })

        print(f"      ✓ Caricate {len(calendar)} gare dall'Excel")
        return calendar

    except Exception as e:
        print(f"      ERR caricamento Excel: {e}")
        return []
