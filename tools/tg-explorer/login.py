"""Connexion unique du compte utilisateur Telethon.

Lit API_ID, API_HASH et PHONE (voir README) et crée la session
<profil>.session dans C:\\Users\\<vous>\\.tg-explorer\\.
A lancer soi-même dans un terminal : le code reçu (et le mot de passe 2FA
éventuel) se tape au clavier et ne passe jamais par le chat.

Usage : python login.py [--profile explorer]
"""
import argparse

from common import HOME, make_client


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", default="explorer", help="nom de la session (défaut : explorer)")
    args = parser.parse_args()

    client, cfg = make_client(args.profile, sync=True)
    client.start(phone=cfg["PHONE"] or None)
    me = client.get_me()
    print(f"Connecté : {me.first_name} (id {me.id}). Session « {args.profile} » enregistrée dans {HOME}.")
    client.disconnect()


if __name__ == "__main__":
    main()
