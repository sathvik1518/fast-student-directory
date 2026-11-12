import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.seed import seed_database


@pytest.fixture(scope="session")
def db_path(tmp_path_factory):
    path = tmp_path_factory.mktemp("db") / "students.db"
    seed_database(path)
    return path


@pytest.fixture
def client(db_path):
    return TestClient(create_app(db_path))
