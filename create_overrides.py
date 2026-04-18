import re, json

text = """
Febbraio Nazionali
14 Febbraio 2026
Strada TROFEO ARTI E MESTIERI DELLA TRADIZIONE MUGELLANA - DONNE
ID Gara: 178935 - Classe: (1.15) Donne Elite
TOSCANA - MUGELLO CIRCUIT SCARPERIA FIRENZE
14 Febbraio 2026
Strada 102^ COPPA SAN GEO
ID Gara: 178948 - Classe: (1.12) Elite e Under 23
LOMBARDIA - PONTE SAN MARCO--PADENGHE SUL GARDA
14 Febbraio 2026
Strada TROFEO CAMPIONI MUGELLANI
ID Gara: 178949 - Classe: (1.12) Elite e Under 23
TOSCANA - MUGELLO CIRCUIT SCARPERIA FIRENZE
15 Febbraio 2026
Strada TROFEO MUGELLO BIKE EXPO
ID Gara: 178950 - Classe: (1.12) Elite e Under 23
TOSCANA - MUGELLO CIRCUIT SCARPERIA FIRENZE
21 Febbraio 2026
Strada 39^ FIRENZE - EMPOLI
ID Gara: 178951 - Classe: (1.12) Elite e Under 23
TOSCANA - FIRENZE
22 Febbraio 2026
Strada 5° MISANO 100 - OPEN GAMES
ID Gara: 178952 - Classe: (1.12) Elite e Under 23
EMILIA ROMAGNA - AUTODROMO MISANO WORLD CIRCUIT MARCO SIMONCELLI
22 Febbraio 2026
Strada 64° GRAN PREMIO LA TORRE
ID Gara: 178953 - Classe: (1.12) Elite e Under 23
TOSCANA - FUCECCHIO (FI) - LOC. TORRE
28 Febbraio 2026
Strada 32° MEMORIAL POLESE
ID Gara: 178954 - Classe: (1.12) Elite e Under 23
VENETO - SAN MICHELE DI PIAVE - SANTA MARIA DEL PIAVE (TV)

Marzo
Internazionali
07 Marzo 2026
Strada STRADE BIANCHE DONNE
ID Gara: 178693 - Classe: (1.WWT) Donne Elite Women's World Tour
TOSCANA - SIENA
07 Marzo 2026
Strada 20° STRADE BIANCHE
ID Gara: 180408 - Classe: (1.UWT) un giorno World Tour
TOSCANA - SIENA
08 Marzo 2026
Strada TROFEO ORO IN EURO - WOMEN'S BIKE RACE
ID Gara: 178694 - Classe: (1,1 WE) Donne Elite
TOSCANA - MONTIGNOSO
09 Marzo 2026
Strada 61° TIRRENO-ADRIATICO
ID Gara: 180409 - Classe: (2.UWT) a tappe World Tour
TOSCANA - VARIE LOCALITà
04 Marzo 2026
Strada 63° TROFEO LAIGUEGLIA
ID Gara: 180406 - Classe: (1.Pro) UCI ProSeries
LIGURIA - ALBENGA - LAIGUEGLIA
15 Marzo 2026
Strada 109^ POPOLARISSIMA
ID Gara: 178643 - Classe: (1.2 ME) Elite e Under 23
VENETO - TREVISO
15 Marzo 2026
Strada 27° TROFEO ALFREDO BINDA - COMUNE DI CITTIGLIO
ID Gara: 178695 - Classe: (1.WWT) Donne Elite Women's World Tour
LOMBARDIA - LUINO - CITTIGLIO
15 Marzo 2026
Strada 13° PICCOLO TROFEO ALFREDO BINDA - VALLI DEL VERBANO
ID Gara: 178696 - Classe: (1.Ncup WJ) Coppa Nazioni Donne Juniores
LOMBARDIA - LUINO - CITTIGLIO
18 Marzo 2026
Strada 107° MILANO-TORINO
ID Gara: 180410 - Classe: (1.Pro) UCI ProSeries
LOMBARDIA - RHO - SUPERGA (TORINO)
21 Marzo 2026
Strada MILANO-SANREMO DONNE
ID Gara: 178706 - Classe: (1.WWT) Donne Elite Women's World Tour
LIGURIA - SANREMO
21 Marzo 2026
Strada 117° MILANO-SANREMO
ID Gara: 180411 - Classe: (1.UWT) un giorno World Tour
LOMBARDIA - PAVIA - SANREMO
22 Marzo 2026
Strada GIRO DELL'APPENNINO DONNE
ID Gara: 178934 - Classe: (1,1 WE) Donne Elite
LIGURIA - GENOVA
25 Marzo 2026
Strada SETTIMANA INTERNAZIONALE COPPI E BARTALI
ID Gara: 180413 - Classe: (2.1) A tappe Classe 1 pro
PIEMONTE - VARIE LOCALITà

Marzo Nazionale
01 Marzo 2026
Strada G.P. GIULIANO BARONTI
ID Gara: 178894 - Classe: (1.14) Juniores
TOSCANA - LOC. CERBAIA
08 Marzo 2026
Strada 67° CIRCUITO DELLE CONCHE
ID Gara: 178895 - Classe: (1.14) Juniores
VENETO - SILVELLA DI CORDIGNANO
08 Marzo 2026
Strada 14° G.P. DELL'INDUSTRIA DI CIVITANOVA MARCHE 9°MEMORIAL "CESARE LATTANZI"
ID Gara: 178955 - Classe: (1.12) Elite e Under 23
MARCHE - CIVITANOVA MARCHE
15 Marzo 2026
Strada 65° GRAN PREMIO SAN GIUSEPPE
ID Gara: 178956 - Classe: (1.13) Under 23
MARCHE - MONTECASSIANO (MC)
28 Marzo 2026
Strada 75° GRAN PREMIO FIERA DELLA POSSENTA
ID Gara: 178957 - Classe: (1.12) Elite e Under 23
LOMBARDIA - CERESARA
29 Marzo 2026
Strada 5° GRAN PREMIO DELLA BATTAGLIA
ID Gara: 178958 - Classe: (1.12) Elite e Under 23
LOMBARDIA - MONTANARA
29 Marzo 2026
Strada GRANPREMIO MARCELLO FALCONE
ID Gara: 180606 - Classe: (1.14) Juniores
LAZIO - TERRACINA

Aprile Internazionale
05 Aprile 2026
Strada 77° TROFEO PIVA
ID Gara: 178644 - Classe: (1.2 MU) Under 23
VENETO - COL SAN MARTINO - TREVISO
06 Aprile 2026
Strada 87° GIRO DEL BELVEDERE
ID Gara: 178645 - Classe: (1.2 MU) Under 23
VENETO - VILLA DI VILLA - FRAZIONE DI CORDIGNANO - TREVISO
06 Aprile 2026
Strada GRAN PREMIO DEL PERDONO
ID Gara: 178907 - Classe: (1.1 MJ) Juniores
LOMBARDIA - MELEGNANO
07 Aprile 2026
Strada 63° G.P. PALIO DEL RECIOTO
ID Gara: 178646 - Classe: (1.2 MU) Under 23
VENETO - NEGRAR - VERONA
12 Aprile 2026
Strada 19° TROFEO CITTA' DI SAN VENDEMIANO - 66° GRAN PREMIO INDUSTRIA & COMMERCIO
ID Gara: 178647 - Classe: (1.2 MU) Under 23
VENETO - SAN VENDEMIANO - TREVISO
19 Aprile 2026
Strada 30° GIRO DELLA PROVINCIA DI BIELLA - 84^ TORINO-BIELLA
ID Gara: 178649 - Classe: (1.2 ME) Elite e Under 23
PIEMONTE - BIELLA
24 Aprile 2026
Strada LIBERAZIONE JUNIOR
ID Gara: 178677 - Classe: (1.1 MJ) Juniores
LAZIO - ROMA
25 Aprile 2026
Strada 79° GRAN PREMIO DELLA LIBERAZIONE
ID Gara: 178648 - Classe: (1.2 MU) Under 23
LAZIO - ROMA
25 Aprile 2026
Strada 71^ COPPA MONTES - GRAN PREMIO DELLA RESISTENZA
ID Gara: 178678 - Classe: (1.1 MJ) Juniores
FRIULI VENEZIA GIULIA - MONFALCONE - GORIZIA
25 Aprile 2026
Strada GRAN PREMIO DELLA LIBERAZIONE DONNE
ID Gara: 178697 - Classe: (1,1 WE) Donne Elite
LAZIO - ROMA
26 Aprile 2026
Strada 15° GIRO DI PRIMAVERA - 2° TROFEO "GINO MAZZER"
ID Gara: 178679 - Classe: (1.1 MJ) Juniores
VENETO - SAN VENDEMIANO - TREVISO

Aprile Nazionale
03 Aprile 2026
Strada TROFEO MICHELE SCARPONI - DUE GIORNI
ID Gara: 179026 - Classe: (1.14) Juniores
MARCHE - CAMERINO
04 Aprile 2026
Strada TROFEO MICHELE SCARPONI - DUE GIORNI
ID Gara: 178896 - Classe: (1.14) Juniores
MARCHE - CAMERINO
05 Aprile 2026
Strada 50^ COPPA CADUTI DI REDA
ID Gara: 178959 - Classe: (1.12) Elite e Under 23
EMILIA ROMAGNA - REDA
11 Aprile 2026
Strada 76^ MILANO - BUSSETO
ID Gara: 178960 - Classe: (1.13) Under 23
EMILIA ROMAGNA - BUSSETO - PARMA
11 Aprile 2026
Strada 62° GIRO DELLA CASTELLANIA
ID Gara: 179114 - Classe: (1.14) Juniores
PIEMONTE - PETTENASCO
12 Aprile 2026
Strada 4° PICCOLA LIEGI DELLE BREGONZE – CASA ENRICO
ID Gara: 178908 - Classe: (1.14) Juniores
VENETO - THIENE
19 Aprile 2026
Strada 3° TROFEO PROTECH - MEM. RODOLFO BARDELLONI
ID Gara: 178909 - Classe: (1.14) Juniores
LOMBARDIA - REZZATO
25 Aprile 2026
Strada 50° GRAN PREMIO LIBERAZIONE CITTA' DI MASSA
ID Gara: 178911 - Classe: (1.14) Juniores
TOSCANA - MASSA
25 Aprile 2026
Strada 79^ COPPA CADUTI NERVIANESI
ID Gara: 178962 - Classe: (1.12) Elite e Under 23
LOMBARDIA - NERVIANO
26 Aprile 2026
Strada 82^ VICENZA - BIONDE
ID Gara: 178963 - Classe: (1.13) Under 23
VENETO - BIONDE DI SALIZZOLE (VR)
"""

overrides = []
lines = [l.strip() for l in text.split("\n") if l.strip()]

for i in range(len(lines)):
    if lines[i].startswith("ID Gara:") and "Classe:" in lines[i]:
        m = re.search(r"Classe:\s*\((.*?)\)", lines[i])
        if m:
            classe_fci = m.group(1)
            # The line above it should be the race name "Strada NOMERACE"
            race_name = lines[i-1].replace("Strada ", "").strip()
            # The line above that should be the date "04 Aprile 2026"
            date_line = lines[i-2]
            overrides.append({"nome": race_name, "classe_fci": classe_fci})

with open('data/user_overrides.json', 'w', encoding='utf-8') as f:
    json.dump(overrides, f, indent=2)
print(f"Created {len(overrides)} manual overrides")
