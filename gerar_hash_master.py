#!/usr/bin/env python3
"""Gera o hash da senha do login de emergência (MASTER_SENHA_HASH).

Uso:
    python3 gerar_hash_master.py

A senha é digitada sem aparecer na tela e não fica gravada em lugar nenhum —
só o hash é impresso. Cole o hash na variável de ambiente MASTER_SENHA_HASH
da Vercel. Não depende de bibliotecas externas.
"""
import getpass
import hashlib
import os
import secrets

ITERACOES = 600_000          # mesmo padrão do Werkzeug 2.3


def gerar(senha):
    sal = secrets.token_hex(8)
    dk = hashlib.pbkdf2_hmac('sha256', senha.encode(), sal.encode(), ITERACOES)
    return f"pbkdf2:sha256:{ITERACOES}${sal}${dk.hex()}"


if __name__ == '__main__':
    s1 = getpass.getpass('Senha para o login de emergência: ')
    if len(s1) < 8:
        raise SystemExit('Use pelo menos 8 caracteres.')
    if s1 != getpass.getpass('Repita a senha: '):
        raise SystemExit('As senhas não conferem.')
    print()
    print('MASTER_SENHA_HASH =')
    print(gerar(s1))
