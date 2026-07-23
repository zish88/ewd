"""Isolated Stage-2 page-type parsers."""

from .connector_parser import parse_connector_pages
from .diagram_parser import parse_diagram_pages

__all__ = ["parse_connector_pages", "parse_diagram_pages"]
