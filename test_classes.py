import re

def norm(s): return s.strip().lower()

def infer_tipo_from_class(classe_fci: str, race_name: str, geo_cat: int):
    classe = classe_fci.upper()
    n = norm(race_name)
    
    is_ci = any(k in n for k in ["campionato italiano","campionati italiani","camp. ital","ci "," ci "])
    is_cr = any(k in n for k in [
        "campionato regionale","camp. reg","camp reg","c.r.",
        "prova valida campionato","valida per il campionato",
        "prova valida per","valida campionato","camp_reg", "camp.regionale"
    ])
    if is_ci: return "internazionale", 3, False, True
    if is_cr: return "nazionale", 2, True, False
    
    m = re.search(r"([12])\.(WWT|UWT|PRO|NCUP|12|13|14|15|19|21|22|23|24|25|26|27|28|30|1|2(?!\d))", classe)
    if m:
        c = m.group(1) + "." + m.group(2)
        if c in ["1.WWT", "1.UWT", "2.UWT", "1.PRO", "1.NCUP", "1.1", "1.2", "2.1", "2.2"]:
            return "internazionale", 3, False, False
        if c in ["1.12", "1.13", "1.14", "1.15"]:
            return "nazionale", 2, False, False
        if c in ["1.19", "1.21", "1.23", "1.24", "1.25", "1.26", "1.27", "1.28", "1.30"]:
            return "regionale", 1, False, False

    if geo_cat == 3: return "internazionale", 3, False, False
    if geo_cat == 2: return "nazionale", 2, False, False
    return "regionale", 1, False, False

classes = ['(1.15) Donne Elite', '(1.12) Elite e Under 23', '(1.WWT) Donne Elite', 
           '(1.UWT) un giorno', '(2.UWT) a tappe', '(1,1 WE) Donne Elite', 
           '(1.Pro) UCI', '(1.2 ME) Elite', '(1.Ncup WJ)', '(1.1 MJ)', '(1.2 MU)', 
           '(1.21) Juniores', '(1.19) Elite s.c.', '(1.24) Allievi', '(1.30)']

for c in classes:
    # also replace comma with dot
    c_fixed = c.replace(',', '.')
    print(c, "=>", infer_tipo_from_class(c_fixed, "Some race", 1))

