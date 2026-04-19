import re

with open(r"c:\Users\vezza\.gemini\antigravity\scratch\italiacrit\data\debug_jun.html", "r", encoding="utf-8") as f:
    text = f.read()

dist_match = re.search(r"di Km\.\s*([\d,\.]+)", text, re.I)
media_match = re.search(r"media di\s*([\d,\.]+)\s*Km/h", text, re.I)

print(f"Distancia match: {dist_match.group(1) if dist_match else 'None'}")
print(f"Media match: {media_match.group(1) if media_match else 'None'}")
