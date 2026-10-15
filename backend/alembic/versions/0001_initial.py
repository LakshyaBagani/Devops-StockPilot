"""Initial schema: products and stock_movements.

Revision ID: 0001
Revises:
Create Date: 2026-10-15

Hand-written and frozen: no app imports, CHECK SQL as literals. Every name is wrapped in op.f()
because the metadata's naming convention would otherwise be applied a second time
(ck_products_ck_products_...).
"""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "products",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sku", sa.String(20), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("category", sa.String(16), nullable=False),
        sa.Column("unit", sa.String(8), nullable=False),
        sa.Column("unit_cost_paise", sa.Integer(), nullable=False),
        sa.Column("reorder_point", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("lead_time_days", sa.SmallInteger(), server_default=sa.text("7"), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_products")),
        sa.UniqueConstraint("sku", name=op.f("uq_products_sku")),
        sa.CheckConstraint(
            "category IN ('STATIONERY', 'ELECTRONICS', 'GROCERY', 'PERSONAL_CARE', 'HOUSEHOLD', "
            "'OTHER')",
            name=op.f("ck_products_category_valid"),
        ),
        sa.CheckConstraint(
            "unit IN ('pcs', 'box', 'pack', 'kg', 'litre')", name=op.f("ck_products_unit_valid")
        ),
        sa.CheckConstraint("unit_cost_paise > 0", name=op.f("ck_products_unit_cost_positive")),
        sa.CheckConstraint("reorder_point >= 0", name=op.f("ck_products_reorder_point_nonneg")),
        sa.CheckConstraint(
            "lead_time_days BETWEEN 1 AND 60", name=op.f("ck_products_lead_time_range")
        ),
    )
    op.create_table(
        "stock_movements",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("delta", sa.Integer(), nullable=False),
        sa.Column("note", sa.String(120), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_stock_movements")),
        sa.ForeignKeyConstraint(
            ["product_id"],
            ["products.id"],
            name=op.f("fk_stock_movements_product_id_products"),
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "kind IN ('IN', 'OUT', 'ADJUST')", name=op.f("ck_stock_movements_kind_valid")
        ),
        sa.CheckConstraint(
            "(kind = 'IN' AND delta > 0) OR (kind = 'OUT' AND delta < 0) "
            "OR (kind = 'ADJUST' AND delta <> 0)",
            name=op.f("ck_stock_movements_delta_sign"),
        ),
    )
    op.create_index(
        op.f("ix_stock_movements_product_id_id"), "stock_movements", ["product_id", "id"]
    )
    op.create_index(op.f("ix_stock_movements_created_at"), "stock_movements", ["created_at"])


def downgrade() -> None:
    op.drop_index(op.f("ix_stock_movements_created_at"), table_name="stock_movements")
    op.drop_index(op.f("ix_stock_movements_product_id_id"), table_name="stock_movements")
    op.drop_table("stock_movements")
    op.drop_table("products")
