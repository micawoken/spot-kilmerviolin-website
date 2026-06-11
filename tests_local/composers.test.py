"""
Script to call the composers API endpoints for local integration testing

Tests the following endpoints:
- GET /api/v1/composers (with and without 'full' meta parameter)
- GET /api/v1/composers/{id} (with valid and invalid IDs)

Usage:
    python composers.test.py

Requirements:
    - Astro development server running at http://localhost:4321
    - requests library: pip install requests
"""

import requests
import json
import sys


BASE_URL = "http://localhost:4321"
COMPOSERS_ENDPOINT = f"{BASE_URL}/api/v1/composers"


def test_get_composers_without_meta():
    """
    Test GET /api/v1/composers without meta parameter.
    Should return a list of composer IDs only.
    """
    print("\n--- Test: GET /api/v1/composers (without meta) ---")
    try:
        response = requests.get(COMPOSERS_ENDPOINT)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {json.dumps(response.json(), indent=2)}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        # If there are composers, they should be IDs (numbers)
        if len(data) > 0:
            assert isinstance(data[0], int), f"Expected composer ID to be int, got {type(data[0])}"
        print("✓ PASSED: Returns list of composer IDs\n")
        return True
    except Exception as e:
        print(f"✗ FAILED: {str(e)}\n")
        return False


def test_get_composers_with_meta_full_false():
    """
    Test GET /api/v1/composers with meta.full=false.
    Should return a list of composer IDs only.
    """
    print("--- Test: GET /api/v1/composers (meta.full=false) ---")
    try:
        params = {"meta": json.dumps({"full": False})}
        response = requests.get(COMPOSERS_ENDPOINT, params=params)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {json.dumps(response.json(), indent=2)}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        if len(data) > 0:
            assert isinstance(data[0], int), f"Expected composer ID to be int, got {type(data[0])}"
        print("✓ PASSED: Returns list of composer IDs\n")
        return True
    except Exception as e:
        print(f"✗ FAILED: {str(e)}\n")
        return False


def test_get_composers_with_meta_full_true():
    """
    Test GET /api/v1/composers with meta.full=true.
    Should return a list of full composer records (objects with id, name, role, etc.).
    """
    print("--- Test: GET /api/v1/composers (meta.full=true) ---")
    try:
        params = {"meta": json.dumps({"full": True})}
        response = requests.get(COMPOSERS_ENDPOINT, params=params)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {json.dumps(response.json(), indent=2)}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        # If there are composers, they should be objects with id, name, role properties
        if len(data) > 0:
            composer = data[0]
            assert isinstance(composer, dict), f"Expected composer to be dict, got {type(composer)}"
            assert "id" in composer, "Composer record should have 'id' property"
            assert "name" in composer, "Composer record should have 'name' property"
        print("✓ PASSED: Returns list of full composer records\n")
        return True
    except Exception as e:
        print(f"✗ FAILED: {str(e)}\n")
        return False


def test_get_composer_by_id_valid():
    """
    Test GET /api/v1/composers/{id} with a valid composer ID.
    Should return the full composer record.
    """
    print("--- Test: GET /api/v1/composers/{id} (valid ID) ---")
    try:
        # First, get a list of composer IDs
        response = requests.get(COMPOSERS_ENDPOINT)
        if response.status_code != 200:
            print("⊘ SKIPPED: Could not fetch composer list to get valid ID\n")
            return None
        
        composer_ids = response.json()
        if len(composer_ids) == 0:
            print("⊘ SKIPPED: No composers in database\n")
            return None
        
        composer_id = composer_ids[0]
        endpoint = f"{COMPOSERS_ENDPOINT}/{composer_id}"
        response = requests.get(endpoint)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {json.dumps(response.json(), indent=2)}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, dict), f"Expected dict, got {type(data)}"
        assert data.get("id") == composer_id, f"Expected id {composer_id}, got {data.get('id')}"
        assert "name" in data, "Composer record should have 'name' property"
        print("✓ PASSED: Returns full composer record\n")
        return True
    except Exception as e:
        print(f"✗ FAILED: {str(e)}\n")
        return False


def test_get_composer_by_id_invalid():
    """
    Test GET /api/v1/composers/{id} with an invalid (non-numeric) ID.
    Should return a 400 error.
    """
    print("--- Test: GET /api/v1/composers/{id} (invalid ID format) ---")
    try:
        endpoint = f"{COMPOSERS_ENDPOINT}/invalid-id"
        response = requests.get(endpoint)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.text}")
        
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("✓ PASSED: Returns 400 error for invalid ID format\n")
        return True
    except Exception as e:
        print(f"✗ FAILED: {str(e)}\n")
        return False


def test_get_composer_by_id_nonexistent():
    """
    Test GET /api/v1/composers/{id} with a non-existent numeric ID.
    Should return a 404 error.
    """
    print("--- Test: GET /api/v1/composers/{id} (non-existent ID) ---")
    try:
        endpoint = f"{COMPOSERS_ENDPOINT}/99999"
        response = requests.get(endpoint)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.text}")
        
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ PASSED: Returns 404 error for non-existent ID\n")
        return True
    except Exception as e:
        print(f"✗ FAILED: {str(e)}\n")
        return False


def main():
    """Run all tests and report results."""
    print("=" * 70)
    print("Composers API Integration Tests")
    print("=" * 70)
    print(f"Testing: {BASE_URL}")
    
    # Check if server is running
    try:
        requests.head(BASE_URL, timeout=2)
    except requests.exceptions.ConnectionError:
        print(f"\n✗ ERROR: Cannot connect to {BASE_URL}")
        print("Make sure the Astro dev server is running: npm run dev")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ ERROR: {str(e)}")
        sys.exit(1)
    
    # Run tests
    results = []
    results.append(("GET /composers (no meta)", test_get_composers_without_meta()))
    results.append(("GET /composers (meta.full=false)", test_get_composers_with_meta_full_false()))
    results.append(("GET /composers (meta.full=true)", test_get_composers_with_meta_full_true()))
    results.append(("GET /composers/{id} (valid)", test_get_composer_by_id_valid()))
    results.append(("GET /composers/{id} (invalid format)", test_get_composer_by_id_invalid()))
    results.append(("GET /composers/{id} (non-existent)", test_get_composer_by_id_nonexistent()))
    
    # Summary
    print("=" * 70)
    print("Test Summary")
    print("=" * 70)
    passed = sum(1 for _, result in results if result is True)
    failed = sum(1 for _, result in results if result is False)
    skipped = sum(1 for _, result in results if result is None)
    
    for test_name, result in results:
        if result is True:
            status = "✓ PASSED"
        elif result is False:
            status = "✗ FAILED"
        else:
            status = "⊘ SKIPPED"
        print(f"{status}: {test_name}")
    
    print(f"\nTotal: {passed} passed, {failed} failed, {skipped} skipped")
    
    # Exit with error code if any tests failed
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()

