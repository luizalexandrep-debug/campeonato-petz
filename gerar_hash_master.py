#!/usr/bin/env python3
"""Gera as contas do login de emergência (funciona sem banco de dados).

Uso:
    python3 gerar_hash_master.py

Pergunta usuário, nome e senha de cada conta — inclusive as do time — e
imprime o JSON pronto para colar na variável de ambiente USUARIOS_EMERGENCIA
da Vercel. As senhas são digitadas às cegas e não ficam gravadas em lugar
nenhum: só os hashes são impressos. Não depende de bibliotecas externas.
"""
import getpass
import hashlib
import json
import secrets

ITERACOES = 600_000          # mesmo padrão do Werkzeug 2.3 usado no servidor


def gerar_hash(senha):
    sal = secrets.token_hex(8)
    dk = hashlib.pbkdf2_hmac('sha256', senha.encode(), sal.encode(), ITERACOES)
    return f"pbkdf2:sha256:{ITERACOES}${sal}${dk.hex()}"


def perguntar_conta():
    usuario = input('Usuário (igual ao do login normal, ex.: master): ').strip()
    if not usuario:
        return None
    nome = input('  Nome para aparecer na tela: ').strip() or usuario
    admin = input('  É administrador? (s/N): ').strip().lower().startswith('s')
    while True:
        s1 = getpass.getpass('  Senha: ')
        if len(s1) < 8:
            print('  Use pelo menos 8 caracteres.')
            continue
        if s1 != getpass.getpass('  Repita a senha: '):
            print('  As senhas não conferem.')
            continue
        break
    return {'username': usuario, 'nome': nome, 'admin': admin,
            'hash': gerar_hash(s1)}


if __name__ == '__main__':
    print('Cadastre as contas. Deixe o usuário em branco para terminar.\n')
    contas = []
    while True:
        c = perguntar_conta()
        if c is None:
            break
        contas.append(c)
        print(f"  ✓ {c['username']} adicionado\n")

    if not contas:
        raise SystemExit('Nenhuma conta cadastrada.')

    print('\n' + '=' * 60)
    print('Cole na Vercel como USUARIOS_EMERGENCIA (tudo em uma linha):')
    print('=' * 60)
    print(json.dumps(contas, ensure_ascii=False, separators=(',', ':')))
