# Copyright (c) 2026, Dércio Bobo and contributors
# For license information, please see license.txt

from frappe.model.document import Document
from frappe.utils import flt, today


class AchadoDeInspecao(Document):
	def validate(self):
		self.calcular_diferenca_de_temperatura()
		self.definir_data_de_conclusao()

	def calcular_diferenca_de_temperatura(self):
		if self.temp_actual is not None and self.temp_max_operacao is not None:
			self.diferenca_sobre_max = flt(self.temp_actual) - flt(self.temp_max_operacao)

	def definir_data_de_conclusao(self):
		if self.estado_da_accao == "Concluído" and not self.data_de_conclusao:
			self.data_de_conclusao = today()
